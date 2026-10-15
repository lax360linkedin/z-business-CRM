import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Plus, Wallet } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { StatusBadge } from '../../components/common/Badge'
import { EmptyState } from '../../components/common/EmptyState'
import { expenseSummary } from '../../utils/expenseRules'
import { formatCurrency, formatDate } from '../../utils/format'
import { useExpenses, useExpenseConfig } from './expenseClient'
import { ExpenseFormDialog } from './ExpenseFormDialog'

const KEY = { Project: 'projectId', Customer: 'customerId', Deal: 'dealId', Company: 'companyId' }
const Stat = ({ label, value, tone }) => <div className="rounded-xl border border-ink-100 bg-white p-3 dark:border-ink-800 dark:bg-ink-900"><p className="text-xs text-ink-500">{label}</p><p className={clsx('mt-1 text-lg font-bold', tone === 'rose' ? 'text-rose-600' : tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-ink-900 dark:text-ink-50')}>{value}</p></div>

/**
 * Expenses linked to a project / customer / deal / company: the cost picture (and budget for a project) plus the list, with "Add expense"
 * pre-filled so nobody retypes the record. `revenue` ({ label, value }) lets the panel show the contribution — revenue minus expenses —
 * without ever changing the revenue records.
 */
export function ExpensesPanel({ relatedType, relatedId, budget = null, revenue = null, preset = {} }) {
  const navigate = useNavigate()
  const { expenses, reload } = useExpenses()
  const { perms } = useExpenseConfig()
  const [open, setOpen] = useState(false)
  const key = KEY[relatedType]
  const rows = useMemo(() => (expenses || []).filter((e) => e[key] === relatedId).sort((a, b) => String(b.date).localeCompare(String(a.date))), [expenses, key, relatedId])
  const s = useMemo(() => expenseSummary(rows, budget), [rows, budget])
  const hidden = rows.length > 0 && rows.every((e) => e.financialHidden)
  const m = (v) => (hidden ? '—' : formatCurrency(v))
  const contribution = revenue ? revenue.value - s.approved : null
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {budget !== null && <Stat label="Budget" value={m(budget)} />}
        <Stat label="Approved expenses" value={m(s.approved)} tone="emerald" />
        <Stat label="Pending expenses" value={m(s.pending)} tone="amber" />
        <Stat label="Total (incl. pending)" value={m(s.total)} />
        {budget !== null && <Stat label="Remaining budget" value={m(s.remaining)} tone={s.remaining < 0 ? 'rose' : null} />}
        {revenue && <Stat label={`${revenue.label} − expenses`} value={m(contribution)} tone={contribution < 0 ? 'rose' : 'emerald'} />}
      </div>
      {s.overBudget && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">Approved expenses are over the project budget.</p>}
      {revenue && <p className="text-xs text-ink-400">Revenue ({revenue.label.toLowerCase()} {m(revenue.value)}) and expenses are separate records — this is a report, nothing on the invoices or payments changes.</p>}
      {s.breakdown.length > 0 && !hidden && <div className="flex flex-wrap gap-2">{s.breakdown.map((b) => <span key={b.name} className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700 dark:bg-ink-800 dark:text-ink-200">{b.name} · <b>{formatCurrency(b.value)}</b></span>)}</div>}
      <section className="rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
        <header className="flex items-center justify-between gap-2 border-b border-ink-100 px-5 py-3 dark:border-ink-800"><h2 className="text-sm font-semibold text-ink-900 dark:text-ink-50">Expenses ({rows.length})</h2>{perms.create && <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Add expense</Button>}</header>
        <div className="p-5">{!expenses ? <p className="text-sm text-ink-400">Loading…</p> : !rows.length ? <EmptyState icon={Wallet} title="No expenses linked" description={`Costs recorded against this ${relatedType.toLowerCase()} appear here.`} /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase text-ink-400 dark:border-ink-800"><th className="pb-2">Expense</th><th className="pb-2">Category</th><th className="pb-2">Date</th><th className="pb-2">Payee</th><th className="pb-2">Status</th><th className="pb-2 text-right">Total</th></tr></thead>
            <tbody>{rows.map((e) => <tr key={e.id} className="border-b border-ink-50 dark:border-ink-800/60"><td className="py-2.5"><Link to={`/expenses/${e.id}`} className="font-medium text-brand-700 hover:underline dark:text-brand-300">{e.number}</Link><span className="block max-w-[220px] truncate text-[11px] text-ink-400">{e.description}</span></td><td>{e.categoryName}</td><td>{formatDate(e.date)}</td><td>{e.vendorName || e.employeeName || '—'}</td><td><StatusBadge status={e.status} /></td><td className="text-right font-medium">{e.total === null ? '—' : formatCurrency(e.total)}</td></tr>)}</tbody></table></div>
        )}</div>
      </section>
      <ExpenseFormDialog open={open} onClose={() => setOpen(false)} preset={{ [key]: relatedId, ...preset }} onSaved={(d) => { reload(); navigate(`/expenses/${d.id}`) }} />
    </div>
  )
}
