import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Building2, UsersRound, Crown } from 'lucide-react'
import { Avatar } from '../../components/common/Avatar'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { isWorking } from '../../utils/employeeRules'

function Node({ node, depth, open, toggle, forceOpen }) {
  const has = node.children?.length > 0
  const isOpen = forceOpen ?? open.has(node.key)
  return (
    <li className="relative">
      <div className={clsx('flex items-center gap-2 rounded-xl border bg-white px-3 py-2 shadow-sm dark:bg-ink-900', node.muted ? 'border-ink-100 opacity-60 dark:border-ink-800' : 'border-ink-200 dark:border-ink-700')} style={node.color ? { borderLeft: `4px solid ${node.color}` } : undefined}>
        {has ? <button type="button" aria-label={isOpen ? `Collapse ${node.label}` : `Expand ${node.label}`} aria-expanded={isOpen} onClick={() => toggle(node.key)} className="rounded p-0.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button> : <span className="w-[19px]" />}
        {node.kind === 'employee' ? <Avatar name={node.label} size="xs" /> : node.kind === 'department' ? <Building2 size={15} className="text-ink-400" /> : node.kind === 'team' ? <UsersRound size={15} className="text-ink-400" /> : null}
        <button type="button" onClick={node.onClick} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-medium text-ink-900 hover:underline dark:text-ink-50">{node.label}</span>{node.sub && <span className="block truncate text-[11px] text-ink-500">{node.sub}</span>}</button>
        {node.badge && <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{node.badge}</span>}
        {has && <span className="shrink-0 text-[11px] text-ink-400">{node.children.length}</span>}
      </div>
      {has && isOpen && <ul className="ml-5 mt-2 space-y-2 border-l border-dashed border-ink-200 pl-4 dark:border-ink-700">{node.children.map((c) => <Node key={c.key} node={c} depth={depth + 1} open={open} toggle={toggle} forceOpen={forceOpen} />)}</ul>}
    </li>
  )
}

/** Built entirely from the live Department → Team → Sub-team → Employee records and the Reports-to links — nothing is drawn from a fixed hierarchy. */
export function OrgChart({ employees, departments, teams }) {
  const navigate = useNavigate()
  const [mode, setMode] = useState('structure')
  const [showInactive, setShowInactive] = useState(false)
  const [open, setOpen] = useState(() => new Set(['root']))
  const [all, setAll] = useState(null)
  const toggle = (k) => { setAll(null); setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n }) }
  const emps = useMemo(() => employees.filter((e) => showInactive || isWorking(e.status)), [employees, showInactive])
  const empNode = (e, children = []) => ({ key: `e-${e.id}`, kind: 'employee', label: e.fullName, sub: `${e.designation}${e.teamName ? ` · ${e.teamName}` : ''}`, badge: e.isDeptHead ? 'Dept head' : e.isTeamLeader ? 'Team leader' : null, muted: !isWorking(e.status), onClick: () => navigate(`/employees/${e.id}`), children })

  const tree = useMemo(() => {
    if (mode === 'reporting') {
      const byMgr = new Map(); emps.forEach((e) => { const k = e.reportsTo && emps.some((x) => x.id === e.reportsTo) ? e.reportsTo : '__root__'; const l = byMgr.get(k) || []; l.push(e); byMgr.set(k, l) })
      const build = (e, seen) => (seen.has(e.id) ? empNode(e) : empNode(e, (byMgr.get(e.id) || []).sort((a, b) => a.fullName.localeCompare(b.fullName)).map((c) => build(c, new Set([...seen, e.id])))))
      return { key: 'root', label: 'Company', sub: 'Reporting lines (Reports to)', children: (byMgr.get('__root__') || []).sort((a, b) => a.fullName.localeCompare(b.fullName)).map((e) => build(e, new Set())) }
    }
    const teamNode = (t) => {
      const members = emps.filter((e) => (e.teamId === t.id && !e.subTeamId) || e.subTeamId === t.id)
      const lead = emps.find((e) => e.id === t.leaderId)
      const subs = teams.filter((s) => s.parentTeamId === t.id && (showInactive || s.status === 'Active'))
      const kids = []
      if (lead) kids.push({ ...empNode(lead), badge: 'Team leader', key: `tl-${t.id}-${lead.id}` })
      if (t.deputyId) { const d = emps.find((e) => e.id === t.deputyId); if (d) kids.push({ ...empNode(d), badge: 'Deputy', key: `td-${t.id}-${d.id}` }) }
      subs.forEach((s) => kids.push(teamNode(s)))
      members.filter((m) => m.id !== t.leaderId && m.id !== t.deputyId).forEach((m) => kids.push(empNode(m)))
      return { key: `t-${t.id}`, kind: 'team', label: t.name, sub: `${t.leaderName ? `Leader: ${t.leaderName}` : 'No team leader'} · ${t.size} member${t.size === 1 ? '' : 's'}`, muted: t.status !== 'Active', onClick: () => navigate(`/teams/${t.id}`), children: kids }
    }
    return {
      key: 'root', label: 'Company', sub: `${departments.filter((d) => d.status === 'Active').length} departments`,
      children: departments.filter((d) => showInactive || d.status === 'Active').map((d) => {
        const head = emps.find((e) => e.id === d.headId)
        const dTeams = teams.filter((t) => t.departmentId === d.id && !t.parentTeamId && (showInactive || t.status === 'Active'))
        const loose = emps.filter((e) => e.departmentId === d.id && !e.teamId && e.id !== d.headId)
        return { key: `d-${d.id}`, kind: 'department', color: d.color, label: d.name, sub: `${head ? `Head: ${head.fullName}` : 'No department head'} · ${d.total} employee${d.total === 1 ? '' : 's'}`, muted: d.status !== 'Active', onClick: () => navigate(`/departments/${d.id}`),
          children: [...(head && !dTeams.some((t) => t.id === head.teamId) ? [{ ...empNode(head), badge: 'Dept head', key: `dh-${d.id}` }] : []), ...dTeams.map(teamNode), ...loose.map((e) => empNode(e))] }
      }),
    }
  }, [mode, emps, departments, teams, navigate, showInactive])

  const collectKeys = (n) => [n.key, ...(n.children || []).flatMap(collectKeys)]
  if (!employees.length) return <EmptyState icon={Building2} title="No employees yet" description="Add employees, departments and teams to see the organisation chart." />
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs dark:border-ink-700 dark:bg-ink-900" role="group" aria-label="Chart type">{[['structure', 'Department → Team → Members'], ['reporting', 'Reporting lines']].map(([k, l]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => { setMode(k); setOpen(new Set(['root'])); setAll(null) }} className={clsx('rounded-md px-3 py-1.5 font-medium', mode === k ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-800')}>{l}</button>)}</div>
        <Button size="sm" variant="secondary" onClick={() => { setOpen(new Set(collectKeys(tree))); setAll(true) }}>Expand all</Button><Button size="sm" variant="secondary" onClick={() => { setOpen(new Set(['root'])); setAll(null) }}>Collapse</Button>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-500"><input type="checkbox" className="h-3.5 w-3.5 rounded border-ink-300 text-brand-600" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
      </div>
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-card dark:border-ink-800 dark:bg-ink-900"><ul className="space-y-2"><Node node={tree} depth={0} open={open} toggle={toggle} forceOpen={all} /></ul></div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-400"><Crown size={12} />Click a department, team or person to open it. The chart is generated from the current records.</p>
    </div>
  )
}
