import { api } from '../../api/mockServer'
import { logProjectActivity, emitProjectsChanged } from '../../hooks/useProjects'
import { PROJECT_TRANSITIONS } from '../../utils/projectRules'
import { USERS } from '../../data/users'

export const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong.'
const nameOf = (id) => USERS.find((u) => u.id === id)?.name || id

/**
 * Moves a project to a new status. Rules: only the listed transitions; cancelling needs a reason; completing stamps the actual end date
 * (and the project reads 100%); reopening a completed project clears it. Every change is written to the timeline and the team is told.
 */
export function changeProjectStatus(project, to, { userId, reason = '' }) {
  if (!(PROJECT_TRANSITIONS[project.status] || []).includes(to)) return Promise.reject(new Error(`A ${project.status} project can’t move to ${to}.`))
  if (to === 'Cancelled' && !reason.trim()) return Promise.reject(new Error('Give a reason for cancelling.'))
  const now = new Date().toISOString()
  const patch = { status: to, updatedAt: now, statusReason: reason.trim() || null }
  if (to === 'Completed') Object.assign(patch, { actualEndDate: now.slice(0, 10), completedAt: now, completedBy: userId, progress: 100 })
  if (project.status === 'Completed') Object.assign(patch, { actualEndDate: null, completedAt: null, completedBy: null, reopenedAt: now, reopenedBy: userId })
  return api.put(`/projects/${project.id}`, patch).then(async (r) => {
    await logProjectActivity(project, userId, {
      type: 'StatusChange', subject: project.status === 'Completed' && to === 'Active' ? 'Project reopened' : to === 'Completed' ? 'Project completed' : `Status changed: ${project.status} → ${to}`,
      notes: reason.trim(), fromStatus: project.status, toStatus: to,
    })
    const who = [...new Set([project.manager, ...(project.team || [])])].filter((id) => id && id !== userId)
    if (who.length) {
      await Promise.all(who.map((uid) => api.post('/notifications', {
        id: `NTF-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`, type: 'Project Update', userId: uid, relatedType: 'Project', relatedId: project.id,
        message: `${nameOf(userId)} changed “${project.name}” to ${to}.`, date: now, read: false,
      }).catch(() => null)))
    }
    emitProjectsChanged()
    return r.data
  })
}
