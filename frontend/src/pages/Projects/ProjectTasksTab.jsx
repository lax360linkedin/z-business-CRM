import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Flag, GitBranch, CheckCircle2, Circle, Diamond } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { Badge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { getUserById } from '../../data/users'
import { TaskFormDialog } from '../Tasks/TaskFormDialog'
import { useTaskActions } from '../Tasks/TaskActions'
import { TaskMenu, StatusSelect } from '../Tasks/TaskViews'
import { DueLabel, AssigneeStack, PriorityMark, TaskFlags } from '../Tasks/TaskBits'
import { emitTasksChanged, errMsg } from '../Tasks/taskClient'
import { ProgressBar } from './ProjectBits'
import { logProjectActivity } from '../../hooks/useProjects'
import { topLevelTasks, taskStats } from '../../utils/projectRules'
import { USERS } from '../../data/users'

/**
 * Tasks and milestones of one project. They are ordinary Task-module records linked to the project (so they appear on the
 * Tasks page and the Calendar, with reminders and audit), and the project's progress is read straight from them.
 */
export function ProjectTasksTab({ project, tasks, perms, user, onChanged, initialFilter = 'all' }) {
  const { toast } = useToast()
  const actions = useTaskActions({ onChanged })
  const [form, setForm] = useState(null) // { milestone?, parent? }
  const [filter, setFilter] = useState(initialFilter)
  const [subBusy, setSubBusy] = useState(null)
  const top = useMemo(() => tasks.filter((t) => !t.parentId), [tasks])
  const subs = useMemo(() => { const m = {}; tasks.filter((t) => t.parentId).forEach((t) => { (m[t.parentId] = m[t.parentId] || []).push(t) }); return m }, [tasks])
  const stats = taskStats(tasks)
  const shown = top.filter((t) => (filter === 'milestones' ? t.taskType === 'Milestone' : filter === 'open' ? !['Completed', 'Cancelled'].includes(t.status) : filter === 'done' ? t.status === 'Completed' : filter === 'overdue' ? t.overdue : true))
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
  const related = { type: 'Project', id: project.id, label: project.name }

  const quickSub = (parent, title) => {
    setSubBusy(parent.id)
    api.post('/tasks', { title, parentId: parent.id, assignees: parent.assignees, dueDate: parent.dueDate, priority: parent.priority, visibility: parent.visibility })
      .then(() => { emitTasksChanged(); onChanged?.() }).catch((e) => toast(errMsg(e), { type: 'error' })).finally(() => setSubBusy(null))
  }
  const afterSave = (task) => {
    if (task?.id) logProjectActivity(project, user.id, { type: 'Updated', subject: `${task.taskType === 'Milestone' ? 'Milestone' : 'Task'} created: ${task.title}`, taskId: task.id })
    onChanged?.()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[['Tasks', stats.total], ['Completed', stats.done], ['Open', stats.open], ['Overdue', stats.overdue, stats.overdue ? 'rose' : null], ['Milestones', `${stats.milestonesDone}/${stats.milestones}`]].map(([l, v, tone]) => (
          <div key={l} className="rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500">{l}</p><p className={clsx('mt-1 text-xl font-bold', tone === 'rose' ? 'text-rose-600' : 'text-ink-900 dark:text-ink-50')}>{v}</p></div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="tablist" aria-label="Task filter">{[['all', 'All'], ['open', 'Open'], ['milestones', 'Milestones'], ['done', 'Done'], ['overdue', 'Overdue']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={clsx('rounded-full px-3 py-1.5 text-xs font-medium', filter === k ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300')}>{l}</button>)}</div>
        {perms.createTasks && <div className="ml-auto flex gap-2"><Button variant="secondary" size="sm" icon={Flag} onClick={() => setForm({ milestone: true })}>Add milestone</Button><Button size="sm" icon={Plus} onClick={() => setForm({})}>Add task</Button></div>}
      </div>

      {!shown.length ? <EmptyState icon={CheckCircle2} title={tasks.length ? 'No tasks match' : 'No tasks yet'} description="Break the project into tasks and milestones — progress is calculated from them automatically." action={perms.createTasks && !tasks.length && <Button icon={Plus} onClick={() => setForm({})}>Add task</Button>} /> : (
        <ul className="space-y-2">
          {shown.map((t) => {
            const kids = subs[t.id] || []
            const milestone = t.taskType === 'Milestone'
            return (
              <li key={t.id} className="rounded-xl border border-ink-100 bg-white dark:border-ink-800 dark:bg-ink-900">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button type="button" aria-label={t.status === 'Completed' ? `${t.title} is completed` : `Complete ${t.title}`} disabled={!t._can?.complete || !perms.updateMilestones} onClick={() => actions.run('complete', t)} className={clsx('shrink-0', t.status === 'Completed' ? 'text-emerald-500' : t._can?.complete && perms.updateMilestones ? 'text-ink-300 hover:text-emerald-500' : 'text-ink-200')}>{t.status === 'Completed' ? <CheckCircle2 size={20} /> : <Circle size={20} />}</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">{milestone && <Badge tone="warning"><Diamond size={10} className="mr-1" />Milestone</Badge>}<Link to={`/tasks/${t.id}`} className={clsx('truncate text-sm font-medium hover:underline', ['Completed', 'Cancelled'].includes(t.status) ? 'text-ink-400 line-through' : 'text-ink-900 dark:text-ink-50')}>{t.title}</Link><span className="font-mono text-[11px] text-ink-400">{t.id}</span><TaskFlags task={t} /></div>
                    {kids.length > 0 && <ProgressBar value={(kids.filter((k) => k.status === 'Completed').length / kids.length) * 100} className="mt-1.5 max-w-xs" />}
                  </div>
                  <div className="hidden items-center gap-4 sm:flex"><AssigneeStack ids={t.assignees} max={2} /><PriorityMark priority={t.priority} label={false} /><DueLabel task={t} /></div>
                  <StatusSelect task={t} run={actions.run} />
                  <TaskMenu task={t} run={actions.run} canLog={actions.canLog} />
                </div>
                {(kids.length > 0 || (perms.createTasks && t.status !== 'Completed' && t.status !== 'Cancelled')) && (
                  <div className="border-t border-ink-50 bg-ink-50/40 px-4 py-2 dark:border-ink-800/60 dark:bg-ink-800/20">
                    <ul className="space-y-1">
                      {kids.map((k) => (
                        <li key={k.id} className="flex items-center gap-2 text-sm"><GitBranch size={12} className="shrink-0 text-ink-300" />
                          <button type="button" aria-label={`Complete ${k.title}`} disabled={!k._can?.complete} onClick={() => actions.run('complete', k)} className={clsx('shrink-0', k.status === 'Completed' ? 'text-emerald-500' : 'text-ink-300 hover:text-emerald-500')}>{k.status === 'Completed' ? <CheckCircle2 size={15} /> : <Circle size={15} />}</button>
                          <Link to={`/tasks/${k.id}`} className={clsx('min-w-0 flex-1 truncate hover:underline', k.status === 'Completed' ? 'text-ink-400 line-through' : 'text-ink-700 dark:text-ink-200')}>{k.title}</Link>
                          <span className="hidden text-xs text-ink-400 sm:inline">{getUserById(k.assignees?.[0])?.name}</span><DueLabel task={k} />
                        </li>
                      ))}
                    </ul>
                    {perms.createTasks && t.status !== 'Completed' && t.status !== 'Cancelled' && (
                      <form className="mt-1.5 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = e.currentTarget.elements.sub.value.trim(); if (v) { quickSub(t, v); e.currentTarget.reset() } }}>
                        <input name="sub" aria-label={`Add a subtask to ${t.title}`} disabled={subBusy === t.id} placeholder="Add a subtask…" className="h-8 flex-1 rounded-lg border border-ink-200 bg-white px-2.5 text-xs placeholder:text-ink-400 focus:border-brand-500 focus:outline-none dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100" />
                        <Button type="submit" size="sm" variant="secondary">Add</Button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-xs text-ink-400">Tasks here are the same records as on the Tasks page and the Calendar — assignees, due dates, reminders and history stay in one place.</p>

      <TaskFormDialog open={!!form} onClose={() => setForm(null)} related={related} preset={form?.milestone ? { taskType: 'Milestone', title: '', assignees: [project.manager], priority: 'Medium' } : { assignees: [project.manager] }} onSaved={afterSave} />
      {actions.dialogs}
    </div>
  )
}
