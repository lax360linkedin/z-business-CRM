import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, Plus, CalendarDays } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { TaskFormDialog } from './TaskFormDialog'
import { DueLabel, TaskStatus, AssigneeStack, PriorityMark } from './TaskBits'
import { useTaskMeta, useOnTasksChanged } from './taskClient'
import { isOpenTask } from '../../utils/taskRules'
import { TASK_RELATED_BY_TYPE } from '../../utils/taskLinks'
import { api } from '../../api/mockServer'

/**
 * "Tasks (n)" for a CRM record's own page: lists the tasks linked to it anywhere in the enquiry → payment chain and
 * creates a new one with the record (and its owner, contact, company, deal …) already filled in.
 */
export function RecordTasksButton({ type, id, label, size = 'md', variant = 'secondary' }) {
  const { perms } = useTaskMeta()
  const [tasks, setTasks] = useState([])
  const [open, setOpen] = useState(false)
  const [create, setCreate] = useState(false)
  const key = TASK_RELATED_BY_TYPE[type]?.linkKey
  const load = useCallback(() => {
    api.get('/tasks', { params: { all: true } }).then((r) => setTasks(r.data.filter((t) => (key && t.links?.[key] === id) || (t.relatedType === type && t.relatedId === id)))).catch(() => {})
  }, [key, id, type])
  useEffect(() => { load() }, [load])
  useOnTasksChanged(load)
  const openCount = tasks.filter(isOpenTask).length
  const overdue = tasks.some((t) => t.overdue)
  return (
    <>
      <Button variant={variant} size={size} icon={ListChecks} onClick={() => setOpen(true)} aria-label={`Tasks for ${label || id}`}>
        Tasks{openCount > 0 && <span className={`ml-0.5 rounded-full px-1.5 text-[11px] font-semibold ${overdue ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'}`}>{openCount}</span>}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} size="lg" title={`Tasks — ${label || id}`} description="Everything linked to this record, including tasks raised on the records it came from or led to."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button><Link to={`/calendar?relatedType=${encodeURIComponent(type)}&relatedId=${encodeURIComponent(id)}`}><Button variant="secondary" icon={CalendarDays}>View in calendar</Button></Link>{perms.create && <Button icon={Plus} onClick={() => { setOpen(false); setCreate(true) }}>New task</Button>}</>}>
        {tasks.length === 0 ? <p className="py-10 text-center text-sm text-ink-400">No tasks yet for this record.</p> : (
          <ul className="divide-y divide-ink-50 dark:divide-ink-800/60">
            {[...tasks].sort((a, b) => (isOpenTask(b) - isOpenTask(a)) || (a.dueDate || '9').localeCompare(b.dueDate || '9')).map((t) => (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`} className="flex items-center gap-3 py-3 hover:bg-ink-50/60 dark:hover:bg-ink-800/40">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink-800 dark:text-ink-100">{t.title}</p><p className="mt-0.5 flex items-center gap-3 text-xs text-ink-400"><span className="font-mono">{t.id}</span><DueLabel task={t} /><PriorityMark priority={t.priority} label={false} /></p></div>
                  <AssigneeStack ids={t.assignees} max={2} /><TaskStatus status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <TaskFormDialog open={create} onClose={() => setCreate(false)} related={{ type, id, label }} onSaved={load} />
    </>
  )
}
