import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { FormField, Input, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { AssignPicker } from './AssignPicker'
import { TaskFormDialog } from './TaskFormDialog'
import { LogActivityDialog } from '../Activities/LogActivityDialog'
import { useDirectory, useTaskMeta, errMsg, emitTasksChanged, addDaysIso } from './taskClient'
import { TASK_RELATED_BY_TYPE } from '../../utils/taskLinks'

const CONTACT_TYPES = ['Call', 'Email', 'WhatsApp', 'Meeting', 'Follow-up', 'Demo']
const CHIPS = [['Tomorrow', 1], ['In 3 days', 3], ['Next week', 7], ['In 2 weeks', 14]]

function DateChips({ value, onPick }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {CHIPS.map(([label, n]) => <button key={label} type="button" onClick={() => onPick(addDaysIso(n))} className={clsx('rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors', value === addDaysIso(n) ? 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-800' : 'text-ink-500 ring-ink-200 hover:bg-ink-50 dark:ring-ink-700 dark:hover:bg-ink-800')}>{label}</button>)}
    </div>
  )
}

/** After finishing a call / follow-up / meeting: one tap schedules the next follow-up on the same record. */
function NextFollowUpDialog({ task, onClose, onCreated }) {
  const { toast } = useToast()
  const { me } = useTaskMeta()
  const [due, setDue] = useState(addDaysIso(2))
  const [time, setTime] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const open = !!task
  const defTitle = task ? `Follow up: ${task.relatedName || task.title}` : ''
  const go = () => {
    setBusy(true); setError('')
    api.post('/tasks', {
      title: title.trim() || defTitle, taskType: 'Follow-up', priority: task.priority === 'Low' ? 'Medium' : task.priority, dueDate: due, dueTime: time || null,
      assignees: task.assignees?.length ? task.assignees : [me?.id], visibility: task.visibility, relatedType: task.relatedType, relatedId: task.relatedId, links: task.links,
    }).then((r) => { toast(`Next follow-up ${r.data.id} scheduled for ${due}.`, { type: 'success' }); emitTasksChanged(); onCreated?.(r.data); onClose() })
      .catch((e) => setError(errMsg(e))).finally(() => setBusy(false))
  }
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Schedule the next follow-up?" description={task ? `Completed: ${task.title}` : ''}
      footer={<><Button variant="ghost" onClick={onClose}>Not now</Button><Button onClick={go} loading={busy}>Create follow-up</Button></>}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        <FormField label="Task"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defTitle} /></FormField>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <FormField label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
          <FormField label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></FormField>
        </div>
        <DateChips value={due} onPick={setDue} />
        <p className="text-xs text-ink-400">Linked to {task?.relatedType?.toLowerCase()} {task?.relatedName} and assigned to the same people.</p>
      </div>
    </Modal>
  )
}

function ReasonDialog({ state, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!state) return null
  const cancelling = state.kind === 'cancel'
  const go = () => {
    if (cancelling && !reason.trim()) { setError('Give a reason for cancelling.'); return }
    setBusy(true); setError('')
    api.post(`/tasks/${state.task.id}/${state.kind}`, { reason }).then(() => { setReason(''); onDone(cancelling ? 'Task cancelled.' : 'Task reopened.') }).catch((e) => setError(errMsg(e))).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={() => { setReason(''); setError(''); onClose() }} size="sm" title={cancelling ? 'Cancel this task?' : 'Reopen this task?'} description={state.task.title}
      footer={<><Button variant="ghost" onClick={onClose}>Keep as is</Button><Button variant={cancelling ? 'danger' : 'primary'} onClick={go} loading={busy}>{cancelling ? 'Cancel task' : 'Reopen task'}</Button></>}>
      <FormField label={cancelling ? 'Reason' : 'Reason (optional)'} required={cancelling} error={error}>
        <Textarea autoFocus value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} placeholder={cancelling ? 'Why is this no longer needed?' : 'What changed?'} className="min-h-[80px]" />
      </FormField>
    </Modal>
  )
}

function RescheduleDialog({ task, onClose, onDone }) {
  const [due, setDue] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [seed, setSeed] = useState(null)
  if (task && seed !== task.id) { setSeed(task.id); setDue(task.dueDate || addDaysIso(1)); setTime(task.dueTime || ''); setError('') }
  if (!task) return null
  const go = () => {
    setBusy(true); setError('')
    api.post(`/tasks/${task.id}/reschedule`, { dueDate: due, dueTime: time || null }).then(() => { setSeed(null); onDone('Task rescheduled.') }).catch((e) => setError(errMsg(e))).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={() => { setSeed(null); onClose() }} size="sm" title="Reschedule" description={task.title} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy}>Reschedule</Button></>}>
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <FormField label="New due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
          <FormField label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></FormField>
        </div>
        <DateChips value={due} onPick={setDue} />
      </div>
    </Modal>
  )
}

function ReassignDialog({ task, onClose, onDone }) {
  const { me, perms } = useTaskMeta()
  const { dir } = useDirectory(!!task)
  const [v, setV] = useState({ assignees: [], assignedTeam: null })
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [seed, setSeed] = useState(null)
  if (task && seed !== task.id) { setSeed(task.id); setV({ assignees: task.assignees || [], assignedTeam: task.assignedTeam || null }); setReason(''); setError('') }
  if (!task) return null
  const go = () => {
    if (!v.assignees.length && !v.assignedTeam) { setError('Choose at least one person, team or role.'); return }
    setBusy(true); setError('')
    api.post(`/tasks/${task.id}/assign`, { assignees: v.assignees, assignedTeam: v.assignedTeam, reason }).then(() => { setSeed(null); onDone('Assignment updated.') }).catch((e) => setError(errMsg(e))).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={() => { setSeed(null); onClose() }} size="md" title={task.assignees?.length ? 'Reassign task' : 'Assign task'} description={task.title} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy}>Save assignment</Button></>}>
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
        <AssignPicker value={v} onChange={setV} dir={dir} me={me?.id} canAssignOthers={!!perms.assign || !!perms.reassign} />
        {task.assignees?.length > 0 && <FormField label="Reason (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded on the timeline" /></FormField>}
      </div>
    </Modal>
  )
}

/**
 * Every quick action on a task (complete, start, hold, reopen, cancel, reschedule, reassign, duplicate, delete,
 * edit, add subtask, log a call/email/WhatsApp/meeting/note, create a follow-up). The hook owns the dialogs;
 * render `dialogs` once and call `run(action, task)` from anywhere. The server decides whether each is allowed.
 */
export function useTaskActions({ onChanged } = {}) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [state, setState] = useState({})
  const patchState = (p) => setState((s) => ({ ...s, ...p }))
  const done = useCallback((msg) => { if (msg) toast(msg, { type: 'success' }); emitTasksChanged(); onChanged?.() }, [toast, onChanged])
  const fail = (e) => toast(errMsg(e), { type: 'error' })

  const complete = (task, force = false) => api.post(`/tasks/${task.id}/complete`, { force }).then((r) => {
    done(r.data._nextTask ? `Task completed — next ${r.data.recurrence.frequency} task ${r.data._nextTask.id} created.` : 'Task completed.')
    if (CONTACT_TYPES.includes(task.taskType) && task.relatedType && !r.data._nextTask) patchState({ followUp: r.data })
  }).catch((e) => {
    if (e?.response?.data?.fields?.code === 'OPEN_SUBTASKS') patchState({ forceComplete: task })
    else fail(e)
  })

  const run = (action, task, extra) => {
    switch (action) {
      case 'open': navigate(`/tasks/${task.id}`); break
      case 'complete': complete(task); break
      case 'status': api.post(`/tasks/${task.id}/status`, { status: extra }).then(() => done(`Moved to ${extra}.`)).catch(fail); break
      case 'reopen': case 'cancel': patchState({ reason: { kind: action, task } }); break
      case 'reschedule': patchState({ reschedule: task }); break
      case 'reassign': patchState({ reassign: task }); break
      case 'edit': patchState({ edit: task }); break
      case 'subtask': patchState({ subtaskOf: task }); break
      case 'followup': patchState({ followFrom: task }); break
      case 'claim': api.post(`/tasks/${task.id}/assign`, { assignees: [extra] }).then(() => done('Assigned to you.')).catch(fail); break
      case 'duplicate': api.post(`/tasks/${task.id}/duplicate`, {}).then((r) => { done(`Duplicated as ${r.data.id}.`); navigate(`/tasks/${r.data.id}`) }).catch(fail); break
      case 'delete': patchState({ del: task }); break
      case 'log': patchState({ log: { task, type: extra } }); break
      default: break
    }
  }

  const loggedRecord = (t) => t && t.relatedType && TASK_RELATED_BY_TYPE[t.relatedType] && t.relatedId && ['Enquiry', 'Lead', 'Deal', 'Contact', 'Company', 'Customer', 'Proposal', 'Quotation', 'Sales Order', 'Invoice', 'Payment'].includes(t.relatedType) ? { type: t.relatedType, id: t.relatedId, label: t.relatedName } : null

  const dialogs = (
    <>
      <ReasonDialog state={state.reason} onClose={() => patchState({ reason: null })} onDone={(m) => { patchState({ reason: null }); done(m) }} />
      <RescheduleDialog task={state.reschedule} onClose={() => patchState({ reschedule: null })} onDone={(m) => { patchState({ reschedule: null }); done(m) }} />
      <ReassignDialog task={state.reassign} onClose={() => patchState({ reassign: null })} onDone={(m) => { patchState({ reassign: null }); done(m) }} />
      <NextFollowUpDialog task={state.followUp} onClose={() => patchState({ followUp: null })} onCreated={() => onChanged?.()} />
      <TaskFormDialog open={!!state.edit} task={state.edit} onClose={() => patchState({ edit: null })} onSaved={() => onChanged?.()} />
      <TaskFormDialog open={!!state.subtaskOf} parent={state.subtaskOf} onClose={() => patchState({ subtaskOf: null })} onSaved={() => onChanged?.()} />
      <TaskFormDialog open={!!state.followFrom} related={state.followFrom?.relatedId ? { type: state.followFrom.relatedType, id: state.followFrom.relatedId } : undefined} preset={state.followFrom ? { title: `Follow up: ${state.followFrom.relatedName || state.followFrom.title}`, taskType: 'Follow-up', dueDate: addDaysIso(2), assignees: state.followFrom.assignees } : undefined} onClose={() => patchState({ followFrom: null })} onSaved={() => onChanged?.()} />
      <ConfirmDialog open={!!state.del} onClose={() => patchState({ del: null })} title={`Delete ${state.del?.id}?`} description={`“${state.del?.title}”${state.del?.subtaskCount ? ` and its ${state.del.subtaskCount} subtask(s)` : ''} will be removed. The deletion stays in the audit trail.`} confirmLabel="Delete task"
        onConfirm={() => api.delete(`/tasks/${state.del.id}`).then(() => { const wasDetail = window.location.pathname === `/tasks/${state.del.id}`; patchState({ del: null }); done('Task deleted.'); if (wasDetail) navigate('/tasks') }).catch((e) => { patchState({ del: null }); fail(e) })} />
      <ConfirmDialog open={!!state.forceComplete} onClose={() => patchState({ forceComplete: null })} tone="primary" title="Subtasks are still open" description="Completing this task leaves its open subtasks behind. Complete it anyway?" confirmLabel="Complete anyway"
        onConfirm={() => { const t = state.forceComplete; patchState({ forceComplete: null }); complete(t, true) }} />
      <LogActivityDialog open={!!state.log} presetType={state.log?.type} related={loggedRecord(state.log?.task)} onClose={() => patchState({ log: null })} onLogged={() => { patchState({ log: null }); done('Activity logged.') }} />
    </>
  )
  return { run, dialogs, canLog: loggedRecord }
}
