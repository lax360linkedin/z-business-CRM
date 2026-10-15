import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/mockServer'
import { useAuth } from '../../context/AuthContext'
import { DEFAULT_DOC_CONFIG, validateFileContent, sizeLabel } from '../../utils/documentRules'

// Browser side of the Documents module. Every call goes through the document API (src/api/documentApi.js), which re-checks the session,
// the caller's rights and the file's real content — nothing here is trusted for security, it only gives faster feedback.
const EVT = 'crm:documents-changed'
const CFG_EVT = 'crm:document-config'
export const emitDocumentsChanged = () => window.dispatchEvent(new Event(EVT))
export const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong.'
export const errList = (e) => e?.response?.data?.errors || [errText(e)]

const multipart = { headers: { 'Content-Type': 'multipart/form-data' } }

export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer())
}

/** Quick pre-check in the browser (the API repeats it on the real bytes). */
export async function precheck(file, config = DEFAULT_DOC_CONFIG) {
  const bytes = await readBytes(file)
  return validateFileContent({ name: file.name, mime: file.type, bytes, size: file.size }, config)
}

export async function uploadDocument(file, meta) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('fileName', file.name)
  fd.append('meta', JSON.stringify(meta))
  const r = await api.post('/documents', fd, multipart)
  emitDocumentsChanged()
  return r.data
}
export async function addVersion(id, file, meta) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('fileName', file.name)
  fd.append('meta', JSON.stringify(meta))
  const r = await api.post(`/documents/${id}/versions`, fd, multipart)
  emitDocumentsChanged()
  return r.data
}
const after = (p) => p.then((r) => { emitDocumentsChanged(); return r.data })
export const updateDocument = (id, patch) => after(api.put(`/documents/${id}`, patch))
export const deleteDocument = (id, reason) => after(api.post(`/documents/${id}/delete`, { reason }))
export const restoreDocument = (id) => after(api.post(`/documents/${id}/restore`))
export const purgeDocument = (id) => after(api.delete(`/documents/${id}`))
export const shareDocument = (id, payload) => after(api.post(`/documents/${id}/share`, payload))
export const revokeShare = (id, shareId) => after(api.delete(`/documents/${id}/share/${shareId}`))
export const restoreVersion = (id, n) => after(api.post(`/documents/${id}/versions/${n}/restore`))
export const fetchDocument = (id) => api.get(`/documents/${id}`).then((r) => r.data)
export const fetchAudit = (id) => api.get(`/documents/${id}/audit`).then((r) => r.data)
export const saveConfig = (cfg) => api.put('/documents/config', cfg).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); return r.data })
export const createFolder = (name) => api.post('/documents/folders', { name }).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); return r.data })
export const renameFolder = (id, name) => api.put(`/documents/folders/${id}`, { name }).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); return r.data })
export const removeFolder = (id) => api.delete(`/documents/folders/${id}`).then((r) => { window.dispatchEvent(new Event(CFG_EVT)); return r.data })

/** The file itself, as a Blob, straight from the authorised endpoint. mode 'preview' or 'download' (each is audited separately). */
export async function fetchFile(id, { version, mode = 'preview' } = {}) {
  try {
    const r = await api.get(`/documents/${id}/file`, { params: { version, mode }, responseType: 'blob' })
    const name = decodeURIComponent(r.headers?.['x-file-name'] || 'document')
    return { blob: r.data, name }
  } catch (e) {
    // an error body arrives as a Blob when responseType is 'blob' — turn it back into a readable message
    if (e?.response?.data instanceof Blob) {
      let message = 'The file could not be opened.'
      try { message = JSON.parse(await e.response.data.text()).message || message } catch { /* keep the default */ }
      const err = new Error(message)
      err.response = { status: e.response.status, data: { message } }
      throw err
    }
    throw e
  }
}
export async function downloadFile(id, opts) {
  const { blob, name } = await fetchFile(id, { ...opts, mode: 'download' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return name
}

/** Documents the caller may see (optionally for one CRM record), refreshed when anything changes. */
export function useDocuments({ relatedType, relatedId, trash = false, enabled = true } = {}) {
  const [docs, setDocs] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    if (!enabled) return Promise.resolve()
    return api.get('/documents', { params: { relatedType, relatedId, trash } }).then((r) => { setDocs(r.data); setError('') }).catch((e) => setError(errText(e)))
  }, [relatedType, relatedId, trash, enabled])
  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    return () => window.removeEventListener(EVT, load)
  }, [load])
  return { docs, error, reload: load }
}

let cfgCache = null
/** Config + the caller's document capabilities, from the API. */
export function useDocConfig() {
  const [state, setState] = useState(cfgCache)
  const load = useCallback(() => api.get('/documents/config').then((r) => { cfgCache = r.data; setState(r.data) }).catch(() => {}), [])
  useEffect(() => {
    load()
    window.addEventListener(CFG_EVT, load)
    return () => window.removeEventListener(CFG_EVT, load)
  }, [load])
  return useMemo(() => ({
    ready: !!state, config: state?.config || DEFAULT_DOC_CONFIG, caps: state?.caps || [], matrix: state?.matrix || {}, me: state?.user || null,
    has: (k) => (state?.caps || []).includes(k), activeCategories: (state?.config?.categories || DEFAULT_DOC_CONFIG.categories).filter((c) => c.active), reload: load,
  }), [state, load])
}
export const resetDocConfigCache = () => { cfgCache = null }

export function useFolders() {
  const [folders, setFolders] = useState([])
  const load = useCallback(() => api.get('/documents/folders').then((r) => setFolders(r.data)).catch(() => {}), [])
  useEffect(() => { load(); window.addEventListener(CFG_EVT, load); return () => window.removeEventListener(CFG_EVT, load) }, [load])
  return { folders, reload: load }
}

// ---- per-user conveniences kept in this browser: saved filters and favourites ---------------------------------------------
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
export function useSavedFilters() {
  const { user } = useAuth()
  const key = `business_crm_doc_filters_${user?.id}`
  const [list, setList] = useState(() => read(key, []))
  const save = (name, filters) => { const next = [...list.filter((f) => f.name !== name), { name, filters, at: Date.now() }]; localStorage.setItem(key, JSON.stringify(next)); setList(next) }
  const remove = (name) => { const next = list.filter((f) => f.name !== name); localStorage.setItem(key, JSON.stringify(next)); setList(next) }
  return { list, save, remove }
}
export function useFavorites() {
  const { user } = useAuth()
  const key = `business_crm_doc_favs_${user?.id}`
  const [ids, setIds] = useState(() => read(key, []))
  const toggle = (id) => { const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]; localStorage.setItem(key, JSON.stringify(next)); setIds(next) }
  return { ids, toggle, has: (id) => ids.includes(id) }
}

export { sizeLabel }
