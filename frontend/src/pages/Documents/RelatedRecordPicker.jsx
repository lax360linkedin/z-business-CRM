import { useEffect, useState } from 'react'
import { api } from '../../api/mockServer'
import { Select } from '../../components/common/FormField'
import { LINK_DEFS } from '../../utils/documentRules'

const PICKABLE = ['Customer', 'Company', 'Contact', 'Lead', 'Enquiry', 'Deal', 'Proposal', 'Quotation', 'Sales Order', 'Project', 'Contract', 'Invoice']
const LABEL = {
  Customer: (r) => r.name, Company: (r) => r.name, Contact: (r) => `${r.name}${r.companyName ? ` · ${r.companyName}` : ''}`, Lead: (r) => `${r.name}${r.company ? ` · ${r.company}` : ''}`, Enquiry: (r) => `${r.id} · ${r.name || r.contactName || r.company || ''}`,
  Deal: (r) => `${r.id} · ${r.name}`, Proposal: (r) => `${r.number} · ${r.title}`, Quotation: (r) => `${r.number} · ${r.customerName}`, 'Sales Order': (r) => `${r.number} · ${r.customerName}`, Project: (r) => `${r.id} · ${r.name}`,
  Contract: (r) => `${r.number} · ${r.title || r.customerName}`, Invoice: (r) => `${r.number} · ${r.customerName}`,
}

/**
 * Optional "belongs to" link for a document uploaded from the central module: pick a record type, then the record. Everything else about the chain
 * (customer, company, contact, deal …) is filled in by the API from that one choice, and the API refuses records the uploader can't open.
 */
export function RelatedRecordPicker({ value, onChange }) {
  const [type, setType] = useState(value?.type || '')
  const [rows, setRows] = useState([])
  useEffect(() => {
    setRows([])
    if (!type) return
    const def = LINK_DEFS.find((d) => d.type === type)
    api.get(`/${def.collection}`, { params: { all: true } }).then((r) => setRows(r.data.slice(0, 400))).catch(() => setRows([]))
  }, [type])
  return (
    <>
      <label className="text-xs font-medium text-ink-500">Link to
        <Select aria-label="Related record type" className="mt-1 !h-9 !w-40 text-xs" value={type} onChange={(e) => { setType(e.target.value); onChange(e.target.value ? { type: e.target.value, id: '' } : null) }}><option value="">General document</option>{PICKABLE.map((t) => <option key={t}>{t}</option>)}</Select>
      </label>
      {type && (
        <label className="text-xs font-medium text-ink-500">Record
          <Select aria-label="Related record" className="mt-1 !h-9 !w-64 text-xs" value={value?.id || ''} onChange={(e) => onChange({ type, id: e.target.value })}><option value="">Choose…</option>{rows.map((r) => <option key={r.id} value={r.id}>{(LABEL[type] || ((x) => x.id))(r)}</option>)}</Select>
        </label>
      )}
    </>
  )
}
