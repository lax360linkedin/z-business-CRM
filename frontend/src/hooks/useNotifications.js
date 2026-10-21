import { useEffect, useMemo, useReducer } from 'react'
import { api } from '../api/mockServer'

// One shared copy of the signed-in person's notifications, polled while a screen that shows them is open (the bell, the Tasks menu entry, the Tasks page, the Notifications page),
// so the unread count is the same everywhere and one request serves them all. The server only ever returns the person's own notifications.
let items = []
let loaded = false
const listeners = new Set()
let timer = null
const POLL_MS = 45000

const isTask = (n) => String(n.type || '').startsWith('Task')
const emit = () => listeners.forEach((fn) => fn())

export function loadNotifications() {
  return api.get('/notifications', { params: { all: true }, noCache: true }).then((res) => {
    items = res.data.map((n) => ({ ...n, date: n.date || n.createdAt })).sort((a, b) => new Date(b.date) - new Date(a.date)) // the server stamps createdAt
    loaded = true
    emit()
    return items
  })
}

const tick = () => { if (document.visibilityState === 'visible') loadNotifications().catch(() => null) }

function start() {
  loadNotifications().catch(() => null)
  timer = setInterval(tick, POLL_MS)
  document.addEventListener('visibilitychange', tick)
}
function stop() {
  clearInterval(timer)
  timer = null
  document.removeEventListener('visibilitychange', tick)
}

/** Marks one notification read (the server only lets people change their own), then refreshes everything that shows the count. */
export function markNotificationRead(id) {
  items = items.map((n) => (n.id === id ? { ...n, read: true } : n))
  emit()
  return api.put(`/notifications/${id}`, { read: true }).then(loadNotifications)
}

export function markManyRead(list) {
  const ids = new Set(list.filter((n) => !n.read).map((n) => n.id))
  if (!ids.size) return Promise.resolve()
  items = items.map((n) => (ids.has(n.id) ? { ...n, read: true } : n))
  emit()
  return Promise.all([...ids].map((id) => api.put(`/notifications/${id}`, { read: true }))).then(loadNotifications)
}

export function markAllNotificationsRead() {
  return api.post('/notifications/read-all').then(loadNotifications)
}

/** { items, unread, taskItems, unreadTasks, loaded, reload } - re-renders when the shared list changes. */
export function useNotifications() {
  const [, bump] = useReducer((n) => n + 1, 0)
  useEffect(() => {
    listeners.add(bump)
    if (listeners.size === 1) start()
    else if (!loaded) loadNotifications().catch(() => null)
    return () => { listeners.delete(bump); if (!listeners.size) stop() }
  }, [])
  return useMemo(() => {
    const taskItems = items.filter(isTask)
    return { items, unread: items.filter((n) => !n.read).length, taskItems, unreadTasks: taskItems.filter((n) => !n.read).length, loaded, reload: loadNotifications }
  }, [items, loaded]) // eslint-disable-line react-hooks/exhaustive-deps
}
