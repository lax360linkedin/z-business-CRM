import { useCallback, useMemo, useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useToast } from '../../context/ToastContext'
import { api } from '../../api/mockServer'
import { emitProductsChanged } from '../../hooks/useProducts'
import { computeProductUsage } from '../../utils/productRules'

const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong.'
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

/** What blocks a delete, in plain words. */
export function usageSummary(u) {
  return [
    u.deals.length && plural(u.deals.length, 'deal'), u.proposals.length && plural(u.proposals.length, 'proposal'), u.quotations.length && plural(u.quotations.length, 'quotation'),
    u.salesOrders.length && plural(u.salesOrders.length, 'sales order'), u.invoices.length && plural(u.invoices.length, 'invoice'), u.projects.length && plural(u.projects.length, 'project'),
  ].filter(Boolean)
}

/**
 * Activate / deactivate / delete with the rules the CRM needs:
 *  • deactivating hides the item from new documents but never touches existing ones (they keep their own snapshot);
 *  • an item that appears on a deal, proposal, quotation, order, invoice or project can't be deleted — it is deactivated instead,
 *    so history and reports stay intact.
 */
export function useProductActions({ data, onChanged }) {
  const { toast } = useToast()
  const [confirmOff, setConfirmOff] = useState(null)
  const [del, setDel] = useState(null)
  const [busy, setBusy] = useState(false)
  const usageOf = useCallback((p) => computeProductUsage(p, data || {}), [data])

  const setStatus = (p, status) => {
    setBusy(true)
    return api.put(`/products/${p.id}`, { status, updatedAt: new Date().toISOString() })
      .then(() => { toast(status === 'Active' ? `${p.name} is active again — it can be selected on new documents.` : `${p.name} deactivated. Existing documents are unchanged.`, { type: 'success' }); emitProductsChanged(); onChanged?.() })
      .catch((e) => toast(errText(e), { type: 'error' })).finally(() => setBusy(false))
  }
  const toggle = (p) => {
    if (p.status === 'Inactive') return setStatus(p, 'Active')
    const u = usageOf(p)
    if (u.openDocs > 0) { setConfirmOff({ p, u }); return null }
    return setStatus(p, 'Inactive')
  }
  const remove = (p) => setDel({ p, u: usageOf(p) })
  const doDelete = () => {
    setBusy(true)
    api.delete(`/products/${del.p.id}`).then(() => { toast(`“${del.p.name}” deleted.`, { type: 'success' }); setDel(null); emitProductsChanged(); onChanged?.(del.p) })
      .catch((e) => toast(errText(e), { type: 'error' })).finally(() => setBusy(false))
  }

  const dialogs = useMemo(() => (
    <>
      <ConfirmDialog open={!!confirmOff} onClose={() => setConfirmOff(null)} tone="primary" loading={busy} title={`Deactivate ${confirmOff?.p.name}?`}
        description={`${confirmOff ? plural(confirmOff.u.openDocs, 'open document') : ''} still use it. They keep their details, but the item will no longer be offered on new proposals, quotations and orders.`}
        confirmLabel="Deactivate" onConfirm={() => { const p = confirmOff.p; setConfirmOff(null); setStatus(p, 'Inactive') }} />
      <Modal open={!!del && !del.u.locked} onClose={() => setDel(null)} size="sm" title={`Delete ${del?.p.name}?`} description="Nothing uses this item, so it can be removed. This cannot be undone."
        footer={<><Button variant="ghost" onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" loading={busy} onClick={doDelete}>Delete</Button></>}>
        <p className="text-sm text-ink-600 dark:text-ink-300">Leads or enquiries that only mention it by name keep that text.</p>
      </Modal>
      <Modal open={!!del && del.u.locked} onClose={() => setDel(null)} size="sm" title="This item can’t be deleted" description={del?.p.name}
        footer={<><Button variant="ghost" onClick={() => setDel(null)}>Close</Button>{del?.p.status !== 'Inactive' && <Button loading={busy} onClick={() => { const p = del.p; setDel(null); setStatus(p, 'Inactive') }}>Deactivate instead</Button>}</>}>
        <p className="text-sm text-ink-600 dark:text-ink-300">It is used by {del ? usageSummary(del.u).join(', ') : ''}. Deleting it would break that history, so it can only be deactivated — it then disappears from new documents but stays on the old ones and in reports.</p>
      </Modal>
    </>
  ), [confirmOff, del, busy]) // eslint-disable-line react-hooks/exhaustive-deps
  return { toggle, remove, dialogs, usageOf, busy }
}
