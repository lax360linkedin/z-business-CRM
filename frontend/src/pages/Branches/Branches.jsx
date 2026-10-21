import { useRef, useState } from 'react'
import { PageExport } from '../../components/common/PageExport'
import { useNavigate } from 'react-router-dom'
import { MapPin, Users, Eye, UserCog, UserPlus, ShieldCheck, Power, Info } from 'lucide-react'
import { Breadcrumbs } from '../../components/common/Breadcrumbs'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/common/Button'
import { Badge, StatusBadge } from '../../components/common/Badge'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { useBranch, emitBranchesChanged } from '../../context/BranchContext'
import { api, errorMessage } from '../../api/http'
import { useBranchSummary, SUMMARY_COLUMNS } from '../../hooks/useBranchSummary'

const COVERAGE = {
  none: { tone: 'danger', label: 'No admin yet', text: (b) => `${b.name} has no admin. Add ${b.adminsMin} or ${b.adminsMax}.` },
  low: { tone: 'warning', label: 'Needs another admin', text: (b) => `Only ${b.adminCount} admin. A branch is run by ${b.adminsMin} to ${b.adminsMax}.` },
  ok: { tone: 'success', label: 'Fully covered', text: (b) => `${b.adminCount} admins run this branch.` },
  high: { tone: 'warning', label: 'More than usual', text: (b) => `${b.adminCount} admins — more than the usual ${b.adminsMax}.` },
}

/** Branch Management (Super Admin): the branches, their status and a side-by-side comparison. Opening a branch switches the global branch selector to it. */
export default function Branches() {
  const root = useRef(null)
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const { branches, setBranch, scope } = useBranch()
  const [version, setVersion] = useState(0)
  const [confirm, setConfirm] = useState(null)
  const { rows, total } = useBranchSummary(branches.map((b) => b.name), version)
  const summary = Object.fromEntries(rows.map((r) => [r.branch, r]))

  const openBranch = (name, to) => { setBranch(name); navigate(to) }
  const toggle = (branch) => {
    const next = branch.status === 'Active' ? 'Inactive' : 'Active'
    api.put(`/branches/${branch.id}`, { status: next })
      .then(() => {
        toast(`${branch.name} is now ${next}.`, { type: 'success' })
        emitBranchesChanged()
        setVersion((v) => v + 1)
      })
      .catch((e) => toast(errorMessage(e), { type: 'error' }))
      .finally(() => setConfirm(null))
  }

  return (
    <div ref={root}>
      <PageHeader title="Branch Management" breadcrumb={<Breadcrumbs items={[{ label: 'Administration', href: '/administration' }, { label: 'Branches' }]} />} description="Salem, Mumbai and Bangalore at a glance. Open a branch to work in it; the branch selector in the header changes the scope of every screen." actions={<PageExport rootRef={root} title="Branch Management" subtitle="Branch comparison" />} />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        {branches.map((b) => {
          const s = summary[b.name] || {}
          return (
            <section key={b.id} className={`rounded-2xl border bg-white p-5 shadow-card dark:bg-ink-900 ${scope === b.name ? 'border-brand-400 dark:border-brand-500' : 'border-ink-100 dark:border-ink-800'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300"><MapPin size={18} /></span>
                  <div>
                    <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">{b.name}</h2>
                    <p className="text-xs text-ink-400">Code {b.code}{scope === b.name ? ' · currently selected' : ''}</p>
                  </div>
                </div>
                <StatusBadge status={b.status} />
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[['Employees', s.employees], ['Leads', s.leads], ['Open deals', s.openDeals], ['Customers', s.customers], ['Projects', s.projects], ['Tickets', s.openTickets]].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-ink-50 px-2 py-2 dark:bg-ink-800/50"><dd className="text-lg font-bold text-ink-900 dark:text-ink-50">{v ?? 0}</dd><dt className="text-[11px] text-ink-500">{k}</dt></div>
                ))}
              </dl>
              <div className="mt-4 rounded-xl border border-ink-100 p-3 dark:border-ink-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500"><ShieldCheck size={13} /> Branch admins</p>
                  {b.adminCoverage && <Badge tone={COVERAGE[b.adminCoverage].tone}>{COVERAGE[b.adminCoverage].label}</Badge>}
                </div>
                {b.adminCoverage && <p className="mt-1 text-xs text-ink-400">{COVERAGE[b.adminCoverage].text(b)} They see this branch only.</p>}
                {(b.admins || []).length > 0 && (
                  <ul className="mt-2 divide-y divide-ink-50 text-sm dark:divide-ink-800/60">
                    {b.admins.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                        <button type="button" onClick={() => navigate(`/administration/users/${a.id}`)} className="truncate text-left font-medium text-brand-700 hover:underline dark:text-brand-300">{a.name}</button>
                        <span className="truncate text-[11px] text-ink-400">{a.username}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Button size="sm" variant="secondary" icon={UserPlus} className="mt-2" onClick={() => navigate(`/administration/users?addAdmin=${encodeURIComponent(b.name)}`)} disabled={b.status !== 'Active'}>Add admin for {b.name}</Button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" icon={Eye} onClick={() => openBranch(b.name, '/dashboard')} disabled={b.status !== 'Active'}>Open branch</Button>
                <Button size="sm" variant="secondary" icon={UserCog} onClick={() => navigate(`/administration/users?branch=${encodeURIComponent(b.name)}`)}>Users</Button>
                <Button size="sm" variant="ghost" icon={Power} onClick={() => setConfirm(b)}>{b.status === 'Active' ? 'Deactivate' : 'Activate'}</Button>
              </div>
            </section>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><Users size={15} className="text-ink-400" /><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Branch comparison</h2></div>
        <div className="scrollbar-thin overflow-x-auto">
          <table className="crm-table w-full min-w-[820px] border-collapse text-sm">
            <thead><tr className="border-b border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/40">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">Branch</th>
              {SUMMARY_COLUMNS.map(([k, label]) => <th key={k} className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.branch} className="border-b border-ink-50 dark:border-ink-800/60">
                  <td className="px-4 py-2.5 font-medium text-ink-800 dark:text-ink-100">{r.branch}</td>
                  {SUMMARY_COLUMNS.map(([k]) => <td key={k} className="px-3 py-2.5 text-right tabular-nums text-ink-700 dark:text-ink-200">{r[k]}</td>)}
                </tr>
              ))}
              <tr className="bg-ink-50/60 font-semibold dark:bg-ink-800/30">
                <td className="px-4 py-2.5 text-ink-900 dark:text-ink-50">All branches</td>
                {SUMMARY_COLUMNS.map(([k]) => <td key={k} className="px-3 py-2.5 text-right tabular-nums text-ink-900 dark:text-ink-50">{total[k]}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-ink-400"><Info size={13} className="mt-0.5 shrink-0" /> Branches are stored on the server. A person assigned to one branch can only read and change that branch’s records — the server enforces this on every request; the branch switcher only changes which branch a Super Admin is looking at.</p>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => toggle(confirm)}
        title={`${confirm?.status === 'Active' ? 'Deactivate' : 'Activate'} ${confirm?.name}?`}
        description={confirm?.status === 'Active' ? `${confirm?.name} will no longer be offered in the branch selector. Its records and people stay exactly as they are.` : `${confirm?.name} will appear in the branch selector again.`}
        confirmLabel={confirm?.status === 'Active' ? 'Deactivate' : 'Activate'}
        tone={confirm?.status === 'Active' ? 'danger' : 'primary'}
      />
    </div>
  )
}
