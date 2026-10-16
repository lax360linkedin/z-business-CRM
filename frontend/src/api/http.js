// The one HTTP client of the app. Everything the CRM shows comes from the FastAPI backend through this instance; there is no in-browser data layer any more.
//
//  * base URL: VITE_API_URL (e.g. https://api.example.com) + /api/v1; in development the Vite dev server proxies /api to the backend, so the variable can stay empty.
//  * every request carries the access token (Authorization: Bearer) and, for the Super Admin, the branch she is working in (X-Branch-Scope). The server ignores that
//    header for everybody else and re-checks everything per request: nothing here is a security boundary.
//  * a 401 caused by an expired access token renews it once with the refresh token (single flight, the refresh token rotates) and replays the request; if the session is
//    gone for good the app is told to sign out.
//  * errors keep the server's shape ({ message, code, fields }) on error.response.data, which is what the pages already read.
import axios from 'axios'
import { getActiveToken, getRefreshToken, storeSession, clearSession, emitSessionExpired, readSessionBlob } from '../utils/sessionToken'

// The address the browser calls. The variable is VITE_API_URL; VITE_API_BASE_URL is accepted as an alias (and wins, so a value typed in the hosting dashboard overrides the committed
// default in .env.production). A trailing slash, or a pasted "/api/v1", is removed: the path is added once, below.
const SERVER = String(import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '')
export const API_BASE = `${SERVER}/api/v1`
if (import.meta.env.PROD && !SERVER && typeof window !== 'undefined' && !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
  // a production build without VITE_API_URL talks to its own host, which only serves the web pages: every API call would fail (404 / 405) until the variable is set and the app rebuilt
  console.error('VITE_API_URL is not set for this deployment: the app cannot reach its server. Set it to the backend address and redeploy.')
}

/** True when the answer did not come from our API at all (a web host answering for it: 404 / 405 / 5xx page instead of the API's JSON with a `code`). */
export function isNotOurApi(err) {
  const status = err?.response?.status
  return !!status && !err.response.data?.code && [404, 405, 502, 503, 504].includes(status)
}
/** What to tell the person when the answer did not come from our API. Which words are true depends on whether this build knows the backend's address at all. */
export const NOT_CONNECTED_MESSAGE = SERVER
  ? 'The server is not answering properly right now (it may still be starting up). Please wait a minute and try again.'
  : 'The sign-in server could not be reached. This site is not connected to its backend yet (the API address is missing from the deployment) - please contact your administrator.'
export const api = axios.create({ baseURL: API_BASE, timeout: 60000, adapter: (config) => cachingAdapter(config) })

// ---- read cache -----------------------------------------------------------------------------------------------------------------------------
// The same GET is often asked for twice within moments (two components on one screen, React's double effect, a screen re-opened right after leaving it). On a hosted database
// every one of those is a full round trip, so identical reads share ONE request while it is in flight and its answer is reused for a few seconds. Safety rules: only plain JSON
// GETs; keyed by URL + branch scope + token (so another account or branch can never be served someone else's answer); the whole cache is emptied by ANY successful write, on
// sign-out and when the scope changes (the key); failures are never kept; callers get their own copy, so changing a list in place cannot damage what the next screen reads.
const READ_TTL_MS = 8000
const reads = new Map() // key -> { at, promise }
const baseAdapter = axios.getAdapter(axios.defaults.adapter)
export const clearReadCache = () => reads.clear()
const copyOf = (res) => ({ ...res, data: typeof structuredClone === 'function' && res.data && typeof res.data === 'object' ? structuredClone(res.data) : res.data })

const cachingAdapter = (config) => {
  const cacheable = String(config.method).toLowerCase() === 'get' && !config.noCache && !config.responseType && !config.signal && !String(config.url).includes('/auth/')
  if (!cacheable) return baseAdapter(config)
  const key = `${axios.getUri(config)}|${config.headers?.['X-Branch-Scope'] || ''}|${String(config.headers?.Authorization || '').slice(-24)}`
  const hit = reads.get(key)
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.promise.then(copyOf)
  const promise = baseAdapter(config)
  const entry = { at: Date.now(), promise }
  reads.set(key, entry)
  promise.catch(() => { if (reads.get(key) === entry) reads.delete(key) })
  if (reads.size > 200) reads.delete(reads.keys().next().value)
  return promise
}

const SCOPE_KEY = 'business_crm_branch_scope_v1'
const readScope = () => { try { return localStorage.getItem(SCOPE_KEY) || '' } catch { return '' } }

api.interceptors.request.use((config) => {
  const token = getActiveToken()
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
  const scope = readScope()
  if (scope && !config.headers['X-Branch-Scope']) config.headers['X-Branch-Scope'] = scope
  return config
})

let refreshing = null
let lastRefreshCode = null // why the last renewal was refused (SESSION_IDLE = left unattended too long)
/** Renews the access token (one request at a time, whoever asks). Resolves with the new access token or null when the session cannot be continued. */
export function refreshAccessToken() {
  if (refreshing) return refreshing
  const refreshToken = getRefreshToken()
  if (!refreshToken) return Promise.resolve(null)
  refreshing = axios.post(`${API_BASE}/auth/refresh`, { refreshToken }, { timeout: 30000 })
    .then((res) => {
      const t = res.data.tokens
      storeSession({ accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, accountId: res.data.user.accountId })
      return t.accessToken
    })
    .catch((err) => { lastRefreshCode = err?.response?.data?.code || null; return null })
    .finally(() => { refreshing = null })
  return refreshing
}

const writeListeners = new Set()
/** Registers a callback fired after every successful write (POST / PUT / PATCH / DELETE) - the list cache uses it to refresh what changed. */
export function onWrite(fn) { writeListeners.add(fn); return () => writeListeners.delete(fn) }

api.interceptors.response.use(
  (res) => {
    if (res.config && !['get', 'head', 'options'].includes(String(res.config.method).toLowerCase()) && !String(res.config.url).includes('/auth/')) {
      reads.clear() // something changed on the server: nothing read before it may be served again
      writeListeners.forEach((fn) => fn(res.config))
    }
    return res
  },
  async (error) => {
    const { response, config } = error
    // a failed write is never silent: say why (screens that explain it themselves can pass { silent: true })
    if (config && !config.silent && !['get', 'head', 'options'].includes(String(config.method).toLowerCase()) && !String(config.url).includes('/auth/') && response?.status !== 401) {
      window.dispatchEvent(new CustomEvent('crm:toast', { detail: { message: errorMessage(error), type: 'error' } }))
    }
    const code = response?.data?.code
    if (response?.status === 401 && config && !config._retried && !String(config.url).includes('/auth/') && readSessionBlob()) {
      config._retried = true
      const token = await refreshAccessToken()
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
        return api(config)
      }
      clearSession()
      emitSessionExpired(code === 'SESSION_IDLE' || lastRefreshCode === 'SESSION_IDLE' ? 'idle' : 'expired')
    } else if (response?.status === 401 && (code === 'SESSION_EXPIRED' || code === 'SESSION_IDLE' || code === 'UNAUTHENTICATED') && readSessionBlob() && String(config?.url).includes('/auth/')) {
      // /auth/me, /auth/activity or /auth/refresh said no: the session is over
      if (!String(config.url).includes('/auth/login')) { clearSession(); emitSessionExpired(code === 'SESSION_IDLE' ? 'idle' : 'expired') }
    }
    return Promise.reject(error)
  },
)

if (typeof window !== 'undefined') {
  // a request whose caller never attached a .catch() must not surface a scary console error just because the session ended under it
  window.addEventListener('unhandledrejection', (e) => {
    const code = e.reason?.response?.data?.code
    if (code === 'SESSION_EXPIRED' || code === 'SESSION_IDLE' || code === 'UNAUTHENTICATED') e.preventDefault()
  })
}

/** The most useful sentence for an error: the server's message, else a plain description of what went wrong. */
export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (isNotOurApi(err)) return NOT_CONNECTED_MESSAGE
  if (err?.response?.data?.message) return err.response.data.message
  if (err?.code === 'ERR_NETWORK') return 'Cannot reach the server. Check your connection and try again.'
  if (err?.code === 'ECONNABORTED') return 'The server took too long to answer. Please try again.'
  return err?.message || fallback
}

export default api
