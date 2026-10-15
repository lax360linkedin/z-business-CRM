import { api } from '../../api/mockServer'
import { emitContractsChanged } from '../../hooks/useContracts'
import { allowedTransitions, effectiveStatus, isRejection, REASON_REQUIRED, DEFAULT_CONTRACT_CONFIG } from '../../utils/contractRules'

export const errText = (e) => e?.response?.data?.message || e?.message || 'Something went wrong.'

/**
 * Save changes to a contract. The server records who changed which field from what to what (the audit trail) and writes the timeline entry itself, so only the change is sent.
 * An optional descriptive entry ("Renewal decision", "Document generated" ...) can ride along; the server stamps who and when.
 */
export async function saveContract(c, patch, _userId, entries = []) {
  const body = entries[0] ? { ...patch, auditEntry: entries[0] } : patch
  const r = await api.put(`/contracts/${c.id}`, body)
  emitContractsChanged()
  return r.data
}

/** Moves a contract along its lifecycle. The server checks the move (permissions, approval rule, reason, dates) and records the approval details, the audit trail and the timeline. */
export async function changeContractStatus(c, to, { perms, config = DEFAULT_CONTRACT_CONFIG, reason = '', comments = '', date = '', method = '' }) {
  const from = effectiveStatus(c, config)
  if (!allowedTransitions(c, perms, config).includes(to)) throw new Error(`You can’t move a ${from} contract to ${to}.`)
  const rejection = isRejection(from, to)
  if ((REASON_REQUIRED[to] || rejection) && !reason.trim()) throw new Error(rejection ? 'Give a reason for returning the contract.' : `Give a reason for ${to === 'Cancelled' ? 'cancelling' : 'terminating'} this contract.`)
  if (to === 'Signed' && !date) throw new Error('Enter the date the contract was signed.')
  if (to === 'Terminated' && !date) throw new Error('Enter the termination effective date.')
  const r = await api.post(`/contracts/${c.id}/status`, { to, reason: reason.trim(), comments: comments.trim(), date: date || undefined, method: method || undefined })
  emitContractsChanged()
  return r.data
}

/** Renewal: a NEW contract (Draft) carries the terms forward; the old one becomes Renewed and keeps its documents, history and invoices. The server does both in one step. */
export async function renewContract(c, { perms }) {
  if (!perms.renew) throw new Error('You don’t have permission to renew contracts.')
  const status = effectiveStatus(c)
  if (!['Active', 'Expiring Soon', 'Expired'].includes(status)) throw new Error(`A ${status} contract can’t be renewed.`)
  const r = await api.post(`/contracts/${c.id}/renew`, {})
  emitContractsChanged()
  return r.data.contract
}

/** Creates a contract from the form. The server numbers it, starts it as a Draft, writes the first audit entry and timeline entry, and refuses a second live contract for the same order or deal unless it was asked for. */
export async function createContract(f, { source }) {
  const rec = {
    title: f.title.trim(), contractType: f.contractType, customerId: f.customerId, customerName: f.customerName, companyId: f.companyId || null, contactId: f.contactId || null,
    dealId: f.dealId || null, proposalId: f.proposalId || null, quotationId: f.quotationId || null, salesOrderId: f.salesOrderId || null, projectId: f.projectId || null, owner: f.owner,
    team: [...new Set([f.owner, ...(f.team || [])])], value: Number(f.value) || 0, billingFrequency: f.billingFrequency, paymentTerms: f.paymentTerms, startDate: f.startDate, endDate: f.endDate,
    renewalDate: f.renewalDate || null, noticePeriodDays: Number(f.noticePeriodDays) || 0, autoRenew: !!f.autoRenew, renewalTerms: f.renewalTerms || '', scope: f.scope || '', terms: f.terms || '',
    notes: f.notes || '', templateId: f.templateId || null, allowDuplicate: source === 'manual',
  }
  const r = await api.post('/contracts', rec)
  emitContractsChanged()
  return r.data
}
