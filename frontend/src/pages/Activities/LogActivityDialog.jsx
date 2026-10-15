import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Link2 } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea, DateInput } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api/mockServer'
import { salesUsers } from '../../data/users'
import { DEAL_STAGES, MEETING_TYPES } from '../../data/constants'
import { resolveActivityLinks } from '../../utils/activityLinks'
import {
  ACTIVITY_TYPE_DEFS, ACTIVITY_DEF, RELATED_TYPES, RELATED_BY_TYPE, ACTIVITY_PRIORITIES, INTERACTION_CHANNELS, CALL_OUTCOME_LIST,
  validateActivity, todayStr,
} from '../../utils/activityRules'

const GROUPS = [...new Set(ACTIVITY_TYPE_DEFS.map((d) => d.group))]
const err = (e) => e?.response?.data?.message || e?.message || 'Could not log the activity.'

/** Loads every collection once so pickers and the "will be linked to" preview are real data. */
export function useCrmLookup(enabled) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!enabled || data) return
    Promise.all(RELATED_TYPES.map((r) => api.get(`/${r.collection}`, { params: { all: true } }).then((x) => [r.collection, x.data]).catch(() => [r.collection, []]))).then((pairs) => setData(Object.fromEntries(pairs)))
  }, [enabled, data])
  const find = useMemo(() => {
    if (!data) return () => null
    const maps = Object.fromEntries(Object.entries(data).map(([k, list]) => [k, new Map(list.map((r) => [r.id, r]))]))
    return (col, id) => maps[col]?.get(id) || null
  }, [data])
  return { data, find }
}

/** Log any of the 19 activity types against a real CRM record. `related` pre-fills (and locks) the record. */
export function LogActivityDialog({ open, onClose, onLogged, presetType, related }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const reps = salesUsers()
  const { data, find } = useCrmLookup(open)
  const blank = { type: presetType || 'Call', relatedType: related?.type || 'Lead', relatedId: related?.id || '', subject: '', description: '', date: todayStr(), time: '', endTime: '', outcome: '', callType: 'Outgoing', duration: '', location: '', toStatus: '', documentName: '', channel: '', customType: '', meetingType: MEETING_TYPES[0], priority: 'Medium', assignedTo: user?.id || '', status: '' }
  const [f, setF] = useState(blank)
  const [q, setQ] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) { setF({ ...blank, type: presetType || 'Call' }); setQ(''); setErrors({}); setError('') } }, [open, presetType, related?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => setF((x) => ({ ...x, ...patch }))
  const def = ACTIVITY_DEF[f.type]
  const need = (k) => def.needs.includes(k)

  // keep the record type valid for the chosen activity
  useEffect(() => {
    if (related || !def.only) return
    if (!def.only.includes(f.relatedType)) setF((x) => ({ ...x, relatedType: def.only[0], relatedId: '' }))
  }, [f.type]) // eslint-disable-line react-hooks/exhaustive-deps

  const relDef = RELATED_BY_TYPE[f.relatedType]
  const options = useMemo(() => {
    if (!data || !relDef) return []
    return (data[relDef.collection] || []).map((r) => ({ id: r.id, label: relDef.label(r) })).filter((o) => o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 80)
  }, [data, relDef, q])
  const selectedRecord = f.relatedId && relDef ? find(relDef.collection, f.relatedId) : null
  const links = useMemo(() => (selectedRecord ? resolveActivityLinks(find, f.relatedType, f.relatedId) : {}), [selectedRecord, find, f.relatedType, f.relatedId])
  const linkChips = RELATED_TYPES.filter((r) => links[r.linkKey]).map((r) => ({ type: r.type, label: r.label(find(r.collection, links[r.linkKey])) }))

  const submit = () => {
    const e = validateActivity(f)
    setErrors(e)
    if (Object.keys(e).length) { setError(Object.values(e)[0]); return }
    setSaving(true); setError('')
    api.post('/activities/log', f).then((r) => { toast(`${f.type} logged on ${r.data.relatedName}.`, { type: 'success' }); onLogged?.(r.data); onClose() })
      .catch((x) => { setErrors((p) => ({ ...p, ...(x?.response?.data?.fields || {}) })); setError(err(x)) }).finally(() => setSaving(false))
  }
  const dealStageStatus = f.relatedType === 'Deal'

  return (
    <Modal open={open} onClose={onClose} title="Log activity" description="Attach it to a real record — every connected record is linked automatically." size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={submit}>{def.schedulable && f.date > todayStr() ? 'Schedule activity' : 'Log activity'}</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <FormField label="Activity type" required error={errors.type} hint={def.help}>
            <Select value={f.type} onChange={(e) => set({ type: e.target.value })}>
              {GROUPS.filter((g) => ACTIVITY_TYPE_DEFS.some((d) => d.group === g && (!related || !d.only || d.only.includes(related.type)))).map((g) => <optgroup key={g} label={g}>{ACTIVITY_TYPE_DEFS.filter((d) => d.group === g && (!related || !d.only || d.only.includes(related.type))).map((d) => <option key={d.type} value={d.type}>{d.type}</option>)}</optgroup>)}
            </Select>
          </FormField>
        </div>

        {related ? (
          <div className="col-span-2"><FormField label="Related to"><Input readOnly value={`${related.type} · ${related.label || related.id}`} className="bg-ink-50 dark:bg-ink-800/50" /></FormField></div>
        ) : (
          <>
            <FormField label="Related to" required error={errors.relatedType}>
              <Select value={f.relatedType} onChange={(e) => { set({ relatedType: e.target.value, relatedId: '' }); setQ('') }}>
                {RELATED_TYPES.filter((r) => !def.only || def.only.includes(r.type)).map((r) => <option key={r.type} value={r.type}>{r.type}</option>)}
              </Select>
            </FormField>
            <FormField label={`Find ${f.relatedType.toLowerCase()}`}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to filter…" /></FormField>
            <div className="col-span-2">
              <FormField label="Record" required error={errors.relatedId}>
                <Select value={f.relatedId} onChange={(e) => set({ relatedId: e.target.value })} error={!!errors.relatedId} size={1}>
                  <option value="">{data ? (options.length ? 'Select a record…' : 'No matching records') : 'Loading records…'}</option>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select>
              </FormField>
            </div>
          </>
        )}

        {linkChips.length > 1 && (
          <div className="col-span-2 rounded-xl bg-brand-50/60 px-3 py-2.5 text-xs dark:bg-brand-900/10">
            <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-brand-700 dark:text-brand-300"><Link2 size={12} /> Will also be linked to</p>
            <div className="flex flex-wrap gap-1.5">{linkChips.filter((c) => c.type !== f.relatedType).map((c) => <span key={c.type} className="rounded-full border border-brand-200 bg-white px-2 py-0.5 text-[11px] text-ink-600 dark:border-brand-800 dark:bg-ink-900 dark:text-ink-300"><b className="text-brand-600">{c.type}</b> {c.label}</span>)}</div>
          </div>
        )}

        {(need('subject') || ['Note', 'WhatsApp', 'SMS', 'Customer Interaction', 'Other / Custom Activity', 'Document Uploaded'].includes(f.type)) && (
          <div className="col-span-2"><FormField label={need('subject') ? 'Title' : 'Title (optional)'} required={need('subject')} error={errors.subject}><Input value={f.subject} maxLength={160} onChange={(e) => set({ subject: e.target.value })} error={!!errors.subject} placeholder={f.type === 'Email' ? 'Email subject' : ''} /></FormField></div>
        )}
        {need('customType') && <div className="col-span-2"><FormField label="Activity kind" required error={errors.customType}><Input value={f.customType} maxLength={60} onChange={(e) => set({ customType: e.target.value })} placeholder="e.g. Contract signing, Webinar attendance" error={!!errors.customType} /></FormField></div>}
        {need('channel') && <FormField label="Channel" required error={errors.channel}><Select value={f.channel} onChange={(e) => set({ channel: e.target.value })}><option value="">Select…</option>{INTERACTION_CHANNELS.map((c) => <option key={c}>{c}</option>)}</Select></FormField>}
        {f.type === 'Call' && (<>
          <FormField label="Outcome" required error={errors.outcome}><Select value={f.outcome} onChange={(e) => set({ outcome: e.target.value })}><option value="">Select…</option>{CALL_OUTCOME_LIST.map((o) => <option key={o}>{o}</option>)}</Select></FormField>
          <FormField label="Call type"><Select value={f.callType} onChange={(e) => set({ callType: e.target.value })}><option>Outgoing</option><option>Incoming</option></Select></FormField>
          <FormField label="Duration (mm:ss)"><Input value={f.duration} onChange={(e) => set({ duration: e.target.value })} placeholder="05:30" /></FormField>
        </>)}
        {f.type === 'Quotation Accepted / Rejected' && <FormField label="Client decision" required error={errors.outcome}><Select value={f.outcome} onChange={(e) => set({ outcome: e.target.value })}><option value="">Select…</option><option>Accepted</option><option>Rejected</option></Select></FormField>}
        {need('toStatus') && (
          <FormField label={dealStageStatus ? 'New stage' : 'New status'} required error={errors.toStatus}>
            {dealStageStatus ? <Select value={f.toStatus} onChange={(e) => set({ toStatus: e.target.value })}><option value="">Select…</option>{DEAL_STAGES.map((s) => <option key={s}>{s}</option>)}</Select> : <Input value={f.toStatus} onChange={(e) => set({ toStatus: e.target.value })} placeholder="e.g. Sent" error={!!errors.toStatus} />}
          </FormField>
        )}
        {need('documentName') && <FormField label="Document" required error={errors.documentName}><Input value={f.documentName} onChange={(e) => set({ documentName: e.target.value })} placeholder="e.g. Signed PO.pdf" error={!!errors.documentName} /></FormField>}
        {f.type === 'Meeting' && <FormField label="Meeting type"><Select value={f.meetingType} onChange={(e) => set({ meetingType: e.target.value })}>{MEETING_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></FormField>}
        {need('location') && <FormField label="Location" required error={errors.location}><Input value={f.location} onChange={(e) => set({ location: e.target.value })} placeholder="Client office, site address…" error={!!errors.location} /></FormField>}

        <FormField label={need('due') ? 'Due date' : 'Date'} required={need('time') || need('due')} error={errors.date}><DateInput value={f.date} onChange={(e) => set({ date: e.target.value })} error={!!errors.date} /></FormField>
        {(need('time') || def.schedulable) && !need('due') && <FormField label="Start time" required={need('time')}><Input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} /></FormField>}
        {need('time') && <FormField label="End time"><Input type="time" value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} /></FormField>}
        {def.schedulable && (<>
          <FormField label="Priority"><Select value={f.priority} onChange={(e) => set({ priority: e.target.value })}>{ACTIVITY_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</Select></FormField>
          <FormField label="Assigned to"><Select value={f.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FormField>
        </>)}
        <div className="col-span-2"><FormField label={need('description') ? 'Details' : 'Notes'} required={need('description')} error={errors.description}><Textarea value={f.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })} error={!!errors.description} className="min-h-[90px]" /></FormField></div>
        {error && <p role="alert" className="col-span-2 flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {error}</p>}
      </div>
    </Modal>
  )
}
