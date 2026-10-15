import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Select } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { mergeTemplate, mergeValues } from '../../utils/contractRules'
import { useContractTemplates, generateContractPdf } from './contractTemplates.js'
import { saveContractDocument } from './ContractDocuments'
import { saveContract, errText } from './contractActions'

/** Fills a template from the contract and the records it is linked to, previews it, and saves the final PDF as a new contract document version. */
export function GenerateContractDialog({ open, onClose, contract, related, user, onDone }) {
  const { toast } = useToast()
  const templates = useContractTemplates().filter((t) => t.active)
  const [tid, setTid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setError(''); setTid((templates.find((t) => t.id === contract.templateId) || templates.find((t) => t.contractType === contract.contractType) || templates[0])?.id || '') } }, [open, contract?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const tpl = templates.find((t) => t.id === tid)
  const merged = useMemo(() => (tpl ? mergeTemplate(tpl.body, mergeValues(contract, related)) : null), [tpl, contract, related])

  const generate = async () => {
    setBusy(true); setError('')
    try {
      const pdf = await generateContractPdf({ title: contract.title, number: contract.number, text: merged.text })
      await saveContractDocument(contract, { name: `${contract.number} - ${contract.title}.pdf`.replace(/[\/:*?"<>|]/g, ''), dataUrl: pdf.dataUrl, sizeKb: pdf.sizeKb, source: 'generated', templateId: tpl.id, note: `Generated from “${tpl.name}” v${tpl.version}` })
      await saveContract(contract, { templateId: tpl.id }, user.id, [{ action: 'Document generated', field: 'Template', to: `${tpl.name} v${tpl.version}` }], null)
      toast('Contract generated — it is saved under Documents.', { type: 'success' }); onDone?.(); onClose()
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} size="xl" title="Generate contract document" description={`${contract.number} · fields are filled from the contract and its linked records`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={Sparkles} loading={busy} disabled={!tpl} onClick={generate}>Generate PDF</Button></>}>
      {!templates.length ? <p className="py-8 text-center text-sm text-ink-400">No active templates. Add one under Contracts → Templates.</p> : (
        <div className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</p>}
          <FormField label="Template"><Select aria-label="Template" value={tid} onChange={(e) => setTid(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} · v{t.version}{t.contractType === contract.contractType ? ' · matches type' : ''}</option>)}</Select></FormField>
          {merged?.missing.length > 0 && <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"><AlertTriangle size={14} className="mt-0.5 shrink-0" />These fields have no value yet and will appear as “[… not set]”: {merged.missing.join(', ')}. Complete the contract or its linked records first, or generate anyway.</p>}
          <pre aria-label="Preview" className="scrollbar-thin max-h-[48vh] overflow-auto whitespace-pre-wrap rounded-xl border border-ink-100 bg-white p-5 font-sans text-sm leading-6 text-ink-800 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-100">{merged?.text}</pre>
        </div>
      )}
    </Modal>
  )
}
