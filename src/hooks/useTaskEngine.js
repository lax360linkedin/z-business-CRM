import { useEffect } from 'react'
import { api } from '../api/mockServer'
import { emitTasksChanged } from '../pages/Tasks/taskClient'

/**
 * There is no background scheduler in this frontend-only workspace, so the task engine (due reminders,
 * overdue alerts, configurable automation, recurrence catch-up) runs from the signed-in browser: once on
 * load and then every minute. It is idempotent on the server — every alert and every automated task
 * carries a dedupe key — so several tabs or users running it never duplicate anything.
 */
export function useTaskEngine(enabled) {
  useEffect(() => {
    if (!enabled) return undefined
    const run = () => api.post('/tasks/engine/run').then((r) => { const o = r.data; if (o.created || o.reminders || o.overdue) emitTasksChanged() }).catch(() => {})
    run()
    const id = setInterval(run, 60000)
    return () => clearInterval(id)
  }, [enabled])
}
