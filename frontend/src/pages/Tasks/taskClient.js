import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/mockServer'
import { TASK_RELATED_TYPES } from '../../utils/taskLinks'

export const errMsg = (e) => e?.response?.data?.message || (e?.code === 'ERR_NETWORK' ? 'Cannot reach the server. Check your connection and try again.' : e?.message) || 'Something went wrong.'

// One signal for "tasks changed" so every open list, the metrics strip and the detail page refresh together.
const EVT = 'crm:tasks-changed'
export const emitTasksChanged = () => window.dispatchEvent(new Event(EVT))
export function useOnTasksChanged(fn) {
  useEffect(() => { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn) }, [fn])
}

/** Current user's task permissions and the workspace's task settings (what the server will enforce). */
export function useTaskMeta() {
  const [meta, setMeta] = useState(null)
  const load = useCallback(() => api.get('/tasks/me').then((r) => setMeta(r.data)).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  return { meta, perms: meta?.perms || {}, me: meta?.user || null, reload: load }
}

/** Every task the server lets the current user see, kept fresh. */
export function useTasks({ poll = 30000 } = {}) {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(() => api.get('/tasks', { params: { all: true } }).then((r) => { setTasks(r.data); setError('') }).catch((e) => setError(errMsg(e))).finally(() => setLoading(false)), [])
  useEffect(() => { load(); const id = setInterval(load, poll); return () => clearInterval(id) }, [load, poll])
  useOnTasksChanged(load)
  return { tasks, loading, error, reload: load }
}

export function useDirectory(enabled = true) {
  const [dir, setDir] = useState(null)
  const load = useCallback(() => api.get('/tasks/assignees').then((r) => setDir(r.data)).catch(() => {}), [])
  useEffect(() => { if (enabled) load() }, [enabled, load])
  useOnTasksChanged(() => { if (enabled) load() })
  return { dir, reload: load }
}

/** All CRM records a task can be attached to — real data for the record picker and the "linked to" preview. */
export function useTaskLookup(enabled) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!enabled || data) return
    Promise.all(TASK_RELATED_TYPES.map((r) => api.get(`/${r.collection}`, { params: { all: true } }).then((x) => [r.collection, x.data]).catch(() => [r.collection, []]))).then((p) => setData(Object.fromEntries(p)))
  }, [enabled, data])
  const find = useMemo(() => {
    if (!data) return () => null
    const maps = Object.fromEntries(Object.entries(data).map(([k, list]) => [k, new Map(list.map((r) => [r.id, r]))]))
    return (col, id) => maps[col]?.get(id) || null
  }, [data])
  return { data, find }
}

export const todayIso = () => new Date().toISOString().slice(0, 10)
export const addDaysIso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
