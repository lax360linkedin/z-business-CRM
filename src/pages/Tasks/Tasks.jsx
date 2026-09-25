import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Plus, Eye, Trash2, CheckCircle2, LayoutList, KanbanSquare } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { SearchBar } from '../../components/common/SearchBar'
import { FilterPanel, FilterToggleButton } from '../../components/common/FilterPanel'
import { DataTable } from '../../components/common/DataTable'
import { StatusBadge, PriorityBadge } from '../../components/common/Badge'
import { Avatar } from '../../components/common/Avatar'
import { Button, IconButton } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { Modal } from '../../components/common/Modal'
import { Select } from '../../components/common/FormField'
import { Tabs } from '../../components/common/Tabs'
import { useCrud } from '../../hooks/useCrud'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { TASK_STATUSES, PRIORITIES } from '../../data/constants'
import { USERS, getUserById } from '../../data/users'
import { formatDate, isOverdue } from '../../utils/format'
import { genId } from '../../utils/csv'

const RELATED_TYPES = ['Lead', 'Deal', 'Customer', 'Project']
const PAGE_SIZE = 10

function TaskCard({ task, onOpen, onStatusChange }) {
  const assignee = getUserById(task.assignedTo)
  const overdue = isOverdue(task.dueDate) && !['Completed', 'Cancelled'].includes(task.status)
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
      onClick={() => onOpen(task)}
      className="cursor-pointer rounded-xl border border-ink-100 bg-white p-3.5 shadow-card transition-shadow hover:shadow-card-hover dark:border-ink-800 dark:bg-ink-900"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{task.title}</p>
        <PriorityBadge priority={task.priority} className="shrink-0 !px-2 !py-0.5 !text-[10px]" />
      </div>
      <p className="mt-1 truncate text-xs text-ink-400">{task.relatedType}: {task.relatedName}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Avatar name={assignee?.name} size="xs" />
          <span className="truncate text-xs text-ink-500 dark:text-ink-400">{assignee?.name?.split(' ')[0] || '—'}</span>
        </div>
        <span className={clsx('text-xs font-medium', overdue ? 'text-rose-500' : 'text-ink-400')}>
          {formatDate(task.dueDate, { year: undefined })}
        </span>
      </div>
      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        <Select value={task.status} onChange={(e) => onStatusChange(task.id, e.target.value)} className="!h-7 !py-1 !text-[11px]">
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
    </div>
  )
}

export default function Tasks() {
  const crud = useCrud('tasks', { searchFields: ['title', 'relatedName', 'description'], pageSize: PAGE_SIZE })
  const { user } = useAuth()
  const { toast } = useToast()

  const [tab, setTab] = useState('mine')
  const [view, setView] = useState('list')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeTask, setActiveTask] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [dragOverStatus, setDragOverStatus] = useState(null)

  useEffect(() => { setPage(1) }, [tab, crud.search, crud.filters])

  const filterDefs = [
    { key: 'priority', label: 'Priorities', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
    { key: 'status', label: 'Statuses', options: TASK_STATUSES.map((s) => ({ value: s, label: s })) },
    { key: 'assignedTo', label: 'Assignees', options: USERS.map((u) => ({ value: u.id, label: u.name })) },
  ]

  const mineCount = useMemo(() => crud.allFiltered.filter((t) => t.assignedTo === user?.id).length, [crud.allFiltered, user])
  const teamCount = useMemo(() => crud.allFiltered.filter((t) => t.assignedTo !== user?.id).length, [crud.allFiltered, user])

  const scoped = useMemo(
    () => crud.allFiltered.filter((t) => (tab === 'mine' ? t.assignedTo === user?.id : t.assignedTo !== user?.id)),
    [crud.allFiltered, tab, user],
  )

  const totalPages = Math.max(1, Math.ceil(scoped.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = useMemo(() => scoped.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [scoped, currentPage])

  const board = useMemo(() => {
    const groups = {}
    TASK_STATUSES.forEach((s) => { groups[s] = [] })
    scoped.forEach((t) => { (groups[t.status] || (groups[t.status] = [])).push(t) })
    return groups
  }, [scoped])

  const updateStatus = (id, status) => {
    crud.update(id, { status }).then(() => toast('Task status updated.', { type: 'success' }))
  }

  const handleDrop = (status) => (e) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    setDragOverStatus(null)
    if (!id) return
    const task = crud.allItems.find((t) => t.id === id)
    if (!task || task.status === status) return
    updateStatus(id, status)
  }

  const columns = [
    { key: 'title', header: 'Task', sortable: true, className: 'font-medium text-ink-800 dark:text-ink-100' },
    { key: 'relatedName', header: 'Related To', render: (row) => <span className="text-ink-500 dark:text-ink-400">{row.relatedType}: {row.relatedName}</span> },
    {
      key: 'assignedTo', header: 'Assigned To',
      render: (row) => {
        const u = getUserById(row.assignedTo)
        return (
          <div className="flex items-center gap-2">
            <Avatar name={u?.name} size="sm" />
            <span>{u?.name || '—'}</span>
          </div>
        )
      },
    },
    { key: 'priority', header: 'Priority', render: (row) => <PriorityBadge priority={row.priority} /> },
    {
      key: 'dueDate', header: 'Due Date', sortable: true,
      render: (row) => {
        const overdue = isOverdue(row.dueDate) && !['Completed', 'Cancelled'].includes(row.status)
        return <span className={overdue ? 'font-semibold text-rose-500' : ''}>{formatDate(row.dueDate)}</span>
      },
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions', header: '', headerClassName: 'w-10',
      render: (row) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {row.status !== 'Completed' && (
            <IconButton icon={CheckCircle2} size="sm" className="hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/20" onClick={() => updateStatus(row.id, 'Completed')} />
          )}
          <IconButton icon={Eye} size="sm" onClick={() => setActiveTask(row)} />
          <IconButton icon={Trash2} size="sm" className="hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20" onClick={() => setDeleteTarget(row)} />
        </div>
      ),
    },
  ]

  const createTask = (data) => {
    setSaving(true)
    crud.create({
      id: genId('TSK'),
      title: data.title,
      relatedType: data.relatedType,
      relatedId: null,
      relatedName: data.relatedName,
      assignedTo: data.assignedTo,
      priority: data.priority,
      dueDate: data.dueDate,
      status: 'Pending',
      description: data.description || '',
    }).then(() => {
      setSaving(false)
      setCreateOpen(false)
      toast('Task created successfully.', { type: 'success' })
    })
  }

  const confirmDelete = () => {
    crud.remove(deleteTarget.id).then(() => {
      toast(`Task "${deleteTarget.title}" deleted.`, { type: 'success' })
      setDeleteTarget(null)
    })
  }

  const activeAssignee = activeTask ? getUserById(activeTask.assignedTo) : null

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Track everything your team needs to get done, on time."
        actions={<Button icon={Plus} onClick={() => setCreateOpen(true)}>Add Task</Button>}
      />

      <Tabs
        tabs={[
          { value: 'mine', label: 'My Tasks', count: mineCount },
          { value: 'team', label: 'Team Tasks', count: teamCount },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-4"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <SearchBar value={crud.search} onChange={crud.setSearch} placeholder="Search tasks by title, related name…" className="w-full max-w-xs" />
        <FilterToggleButton active={filtersOpen} count={Object.values(crud.filters).filter((v) => v && v !== 'all').length} onClick={() => setFiltersOpen((o) => !o)} />
        {selected.length > 0 && view === 'list' && <span className="text-xs text-ink-500 dark:text-ink-400">{selected.length} selected</span>}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-1 dark:border-ink-700 dark:bg-ink-900">
          <Button variant={view === 'list' ? 'subtle' : 'ghost'} size="sm" icon={LayoutList} onClick={() => setView('list')}>List</Button>
          <Button variant={view === 'board' ? 'subtle' : 'ghost'} size="sm" icon={KanbanSquare} onClick={() => setView('board')}>Board</Button>
        </div>
      </div>

      {filtersOpen && (
        <div className="mb-4">
          <FilterPanel filters={filterDefs} values={crud.filters} onChange={(k, v) => crud.setFilters((f) => ({ ...f, [k]: v }))} onClear={() => crud.setFilters({})} />
        </div>
      )}

      {view === 'list' ? (
        <DataTable
          columns={columns}
          data={pageItems}
          loading={crud.loading}
          onRowClick={(row) => setActiveTask(row)}
          selectable
          selected={selected}
          onSelectChange={setSelected}
          sort={crud.sort}
          onSortChange={crud.setSort}
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
          total={scoped.length}
          pageSize={PAGE_SIZE}
          emptyTitle="No tasks found"
          emptyDescription="Try adjusting your search or filters, or add a new task to get started."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {TASK_STATUSES.map((status) => (
            <div
              key={status}
              onDragOver={(e) => { e.preventDefault(); setDragOverStatus(status) }}
              onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
              onDrop={handleDrop(status)}
              className={clsx(
                'flex flex-col gap-3 rounded-2xl border border-dashed p-3 transition-colors',
                dragOverStatus === status ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500 dark:bg-brand-900/10' : 'border-ink-200 bg-ink-50/50 dark:border-ink-800 dark:bg-ink-900/30',
              )}
            >
              <div className="flex items-center justify-between px-1">
                <StatusBadge status={status} />
                <span className="text-xs font-medium text-ink-400">{board[status]?.length || 0}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2.5">
                {(board[status] || []).map((t) => (
                  <TaskCard key={t.id} task={t} onOpen={setActiveTask} onStatusChange={updateStatus} />
                ))}
                {(!board[status] || board[status].length === 0) && (
                  <p className="py-6 text-center text-xs text-ink-400">No tasks here.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <FormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add New Task"
        description="Create a task and assign it to a team member."
        submitLabel="Create Task"
        loading={saving}
        onSubmit={createTask}
        defaultValues={{ relatedType: RELATED_TYPES[0], assignedTo: user?.id, priority: 'Medium' }}
        fields={[
          { name: 'title', label: 'Task title', required: true, span: 2 },
          { name: 'relatedType', label: 'Related to', type: 'select', options: RELATED_TYPES.map((t) => ({ value: t, label: t })), required: true, span: 1 },
          { name: 'relatedName', label: 'Related name', placeholder: 'e.g. Rahul Sharma / Acme Corp', required: true, span: 1 },
          { name: 'assignedTo', label: 'Assign to', type: 'select', options: USERS.map((u) => ({ value: u.id, label: u.name })), required: true, span: 1 },
          { name: 'priority', label: 'Priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: p })), required: true, span: 1 },
          { name: 'dueDate', label: 'Due date', type: 'date', required: true, span: 1 },
          { name: 'description', label: 'Description', type: 'textarea', span: 2 },
        ]}
      />

      <Modal
        open={!!activeTask}
        onClose={() => setActiveTask(null)}
        title={activeTask?.title}
        description={activeTask ? `${activeTask.relatedType}: ${activeTask.relatedName}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setActiveTask(null)}>Close</Button>
            {activeTask?.status !== 'Completed' && (
              <Button
                icon={CheckCircle2}
                onClick={() => { updateStatus(activeTask.id, 'Completed'); setActiveTask(null) }}
              >
                Mark Complete
              </Button>
            )}
          </>
        }
      >
        {activeTask && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={activeTask.status} />
              <PriorityBadge priority={activeTask.priority} />
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Assigned To</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Avatar name={activeAssignee?.name} size="sm" />
                  <span className="text-ink-800 dark:text-ink-100">{activeAssignee?.name || '—'}</span>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Due Date</p>
                <p className={clsx('mt-1.5', isOverdue(activeTask.dueDate) && activeTask.status !== 'Completed' ? 'font-semibold text-rose-500' : 'text-ink-800 dark:text-ink-100')}>
                  {formatDate(activeTask.dueDate)}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Description</p>
              <p className="mt-1.5 text-sm text-ink-600 dark:text-ink-300">{activeTask.description || 'No description provided.'}</p>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete this task?"
        description={`"${deleteTarget?.title}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete Task"
      />
    </div>
  )
}
