import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { changeProjectStatus, errText } from './projectActions'

const COPY = {
  Active: ['Start / resume project', 'The project becomes Active.'],
  'On Hold': ['Put project on hold', 'Work pauses. Add a note so the team knows why.'],
  Completed: ['Complete project', 'Marks the project 100% complete and records today as the actual completion date.'],
  Cancelled: ['Cancel project', 'Cancelled projects stay in the history but drop out of active work.'],
  Planned: ['Restore to planned', 'The project goes back to Planned.'],
}

/** Confirms a status change; asks for a reason when one is required and warns about work that is still open. */
export function ProjectStatusDialog({ project, to, openTasks = 0, onClose, onDone }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setReason(''); setError('') }, [project?.id, to])
  if (!project || !to) return null
  const reopening = project.status === 'Completed' && to === 'Active'
  const [title, text] = reopening ? ['Reopen project', 'Reopens the completed project and clears its completion date.'] : COPY[to]
  const go = () => {
    setBusy(true); setError('')
    changeProjectStatus(project, to, { userId: user.id, reason }).then((p) => { toast(`${project.name} — ${reopening ? 'reopened' : to}.`, { type: 'success' }); onDone?.(p); onClose() }).catch((e) => setError(errText(e))).finally(() => setBusy(false))
  }
  return (
    <Modal open onClose={onClose} size="sm" title={title} description={project.name}
      footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant={to === 'Cancelled' ? 'danger' : 'primary'} loading={busy} onClick={go}>{title}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-600 dark:text-ink-300">{text}</p>
        {to === 'Completed' && openTasks > 0 && <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{openTasks} task{openTasks > 1 ? 's are' : ' is'} still open. They stay open on the Tasks page after the project is completed.</p>}
        {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
        {(to === 'Cancelled' || to === 'On Hold' || to === 'Completed' || reopening) && (
          <FormField label={to === 'Cancelled' ? 'Reason' : 'Note (optional)'} required={to === 'Cancelled'}><Textarea autoFocus value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} className="min-h-[72px]" placeholder={to === 'Cancelled' ? 'Why is this project being cancelled?' : 'Anything the team should know'} /></FormField>
        )}
      </div>
    </Modal>
  )
}
