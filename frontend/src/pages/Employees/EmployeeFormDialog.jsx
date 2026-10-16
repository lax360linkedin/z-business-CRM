import { useEffect, useState } from 'react'
import { Modal } from '../../components/common/Modal'
import { Button } from '../../components/common/Button'
import { FormField, Input, Select, Textarea } from '../../components/common/FormField'
import { useToast } from '../../context/ToastContext'
import { EMPLOYMENT_TYPES, WORK_MODES, SHIFTS, WORK_LOCATIONS, OTHER_LOCATION, splitLocation, GENDERS, isWorking, wouldCreateCycle, todayKey } from '../../utils/employeeRules'
import { createEmployee, updateEmployee, orgErr, orgFields } from './employeeClient'
import { useBranch } from '../../context/BranchContext'

const blank = () => ({ id: '', branch: '', fullName: '', officialEmail: '', mobile: '', altPhone: '', gender: '', dob: '', personalEmail: '', address: '', emergencyContact: { name: '', phone: '', relation: '' }, designation: '', jobTitle: '', joinDate: todayKey(), departmentId: '', teamId: '', subTeamId: '', employmentType: 'Full-time', reportsTo: '', workLocation: WORK_LOCATIONS[0], shift: SHIFTS[0], workMode: 'On-site' })
const Section = ({ children }) => <p className="border-b border-ink-100 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-400 sm:col-span-2 dark:border-ink-800">{children}</p>

/** Add / edit an employee. The CRM login is NOT part of this form — access is granted separately and linked to User Management. */
export function EmployeeFormDialog({ open, onClose, employee = null, org, onSaved }) {
  const { toast } = useToast()
  const { activeNames, assigned, isGlobal } = useBranch()
  const { departments = [], teams = [], employees = [], perms = {} } = org
  const [f, setF] = useState(blank)
  const [errors, setErrors] = useState({}); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [createLogin, setCreateLogin] = useState(false)
  const [loc, setLoc] = useState({ choice: WORK_LOCATIONS[0], custom: '' }) // the Work location dropdown + the typed place when Others is chosen
  const set = (p) => setF((x) => ({ ...x, ...p }))
  useEffect(() => {
    if (!open) return
    setErrors({}); setError(''); setCreateLogin(false); setRequestId(`REQ-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`)
    setLoc(splitLocation(employee ? employee.workLocation : blank().workLocation))
    setF(employee ? { ...blank(), ...Object.fromEntries(Object.keys(blank()).map((k) => [k, employee[k] ?? blank()[k]])), emergencyContact: employee.emergencyContact || blank().emergencyContact, id: employee.id } : blank())
  }, [open, employee?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null
  const sens = !employee || !employee.sensitiveHidden
  const deptTeams = teams.filter((t) => t.departmentId === f.departmentId && !t.parentTeamId && (t.status === 'Active' || t.id === f.teamId))
  const subTeams = teams.filter((t) => t.parentTeamId === f.teamId && (t.status === 'Active' || t.id === f.subTeamId))
  const managers = employees.filter((e) => isWorking(e.status) && e.id !== employee?.id && !wouldCreateCycle(employees, employee?.id || '__new__', e.id))
  const save = () => {
    if (busy) return
    const place = loc.choice === OTHER_LOCATION ? loc.custom.trim() : loc.choice
    if (loc.choice === OTHER_LOCATION && !place) return setErrors({ workLocation: 'Enter the work location.' })
    if (place.length > 80) return setErrors({ workLocation: 'Work location can be at most 80 characters.' })
    if (!place && !employee) return setErrors({ workLocation: 'Choose a work location.' })
    setBusy(true); setError(''); setErrors({})
    const payload = { ...f, workLocation: place, requestId, teamId: f.teamId || null, subTeamId: f.subTeamId || null, reportsTo: f.reportsTo || null }
    if (employee) delete payload.id
    ;(employee ? updateEmployee(employee.id, payload) : createEmployee(payload)).then((e) => { toast(employee ? 'Employee updated.' : `${e.fullName} added as ${e.id}.`, { type: 'success' }); onSaved?.(e, !employee && createLogin); onClose() }).catch((e) => { setErrors(orgFields(e)); setError(orgErr(e)) }).finally(() => setBusy(false))
  }
  const inp = (k, label, props = {}) => <FormField label={label} error={errors[k]} required={props.required}><Input aria-label={label} value={f[k] || ''} onChange={(e) => set({ [k]: e.target.value })} error={!!errors[k]} {...props} /></FormField>
  const sel = (k, label, list, extra = {}) => <FormField label={label} error={errors[k]} required={extra.required}><Select aria-label={label} value={f[k] || ''} onChange={(e) => set({ [k]: e.target.value, ...(extra.reset || {}) })} error={!!errors[k]}>{extra.blank !== false && <option value="">{extra.blank || 'Select'}</option>}{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
  return (
    <Modal open onClose={onClose} size="xl" title={employee ? `Edit ${employee.fullName}` : 'Add employee'} description="The employee master. Status changes and CRM access are handled with their own actions so they are dated, reasoned and attributed."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{employee ? 'Save changes' : 'Add employee'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && !Object.keys(errors).length && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{error}</p>}
        <Section>Basic information</Section>
        {!employee && inp('id', 'Employee ID', { placeholder: 'Auto-generated (EMP-0xx) if left blank' })}
        {inp('fullName', 'Full name', { required: true })}{inp('officialEmail', 'Official email', { required: true, type: 'email' })}{inp('mobile', 'Mobile number')}{inp('altPhone', 'Alternate number')}
        {sens && <>{sel('gender', 'Gender', GENDERS.map((g) => [g, g]), { blank: 'Not specified' })}{inp('dob', 'Date of birth', { type: 'date', max: todayKey() })}{inp('personalEmail', 'Personal email', { type: 'email' })}
          <FormField label="Address" className="sm:col-span-2" error={errors.address}><Textarea aria-label="Address" value={f.address || ''} onChange={(e) => set({ address: e.target.value })} className="min-h-[50px]" /></FormField>
          <FormField label="Emergency contact name"><Input aria-label="Emergency contact name" value={f.emergencyContact?.name || ''} onChange={(e) => set({ emergencyContact: { ...f.emergencyContact, name: e.target.value } })} /></FormField>
          <div className="grid grid-cols-2 gap-3"><FormField label="Emergency phone"><Input aria-label="Emergency phone" value={f.emergencyContact?.phone || ''} onChange={(e) => set({ emergencyContact: { ...f.emergencyContact, phone: e.target.value } })} /></FormField><FormField label="Relation"><Input aria-label="Relation" value={f.emergencyContact?.relation || ''} onChange={(e) => set({ emergencyContact: { ...f.emergencyContact, relation: e.target.value } })} /></FormField></div></>}
        <Section>Employment & organisation</Section>
        {inp('designation', 'Designation', { required: true })}{inp('jobTitle', 'Job title')}{inp('joinDate', 'Joining date', { type: 'date', required: true })}{sel('employmentType', 'Employment type', EMPLOYMENT_TYPES.map((x) => [x, x]), { blank: false })}
        {isGlobal || !employee
          ? sel('branch', 'Branch', activeNames.map((n) => [n, n]), { required: !assigned, blank: assigned ? `${assigned} (your branch)` : 'Select a branch' })
          : <FormField label="Branch" hint="Only the Super Admin can change a person's branch."><Input aria-label="Branch" value={employee.branch || 'Not assigned'} disabled readOnly /></FormField>}
        {sel('departmentId', 'Department', departments.filter((d) => d.status === 'Active' || d.id === f.departmentId).map((d) => [d.id, d.name]), { required: true, reset: { teamId: '', subTeamId: '' } })}
        {sel('teamId', 'Team', deptTeams.map((t) => [t.id, t.name]), { blank: f.departmentId ? 'No team' : 'Choose a department first', reset: { subTeamId: '' } })}
        {sel('subTeamId', 'Sub-team', subTeams.map((t) => [t.id, t.name]), { blank: subTeams.length ? 'No sub-team' : 'None available' })}
        {sel('reportsTo', 'Reports to', managers.map((m) => [m.id, `${m.fullName} · ${m.designation}`]), { blank: 'No manager (top of the structure)' })}
        {sel('workMode', 'Work mode', WORK_MODES.map((x) => [x, x]), { blank: false })}<FormField label="Work location" error={errors.workLocation} required={!employee}><Select aria-label="Work location" value={loc.choice} onChange={(e) => { setLoc((l) => ({ ...l, choice: e.target.value })); setErrors((x) => ({ ...x, workLocation: '' })) }} error={!!errors.workLocation}>{!loc.choice && <option value="">{employee ? 'Not set' : 'Select'}</option>}{WORK_LOCATIONS.map((x) => <option key={x} value={x}>{x}</option>)}</Select>{loc.choice === OTHER_LOCATION && <Input aria-label="Other work location" placeholder="Enter the work location" maxLength={80} value={loc.custom} onChange={(e) => { setLoc((l) => ({ ...l, custom: e.target.value })); setErrors((x) => ({ ...x, workLocation: '' })) }} error={!!errors.workLocation} />}</FormField>{sel('shift', 'Shift', [...new Set([...SHIFTS, f.shift].filter(Boolean))].map((x) => [x, x]), { blank: false })}
        <p className="text-xs text-ink-400 sm:col-span-2">The team leader is derived from the team. Reporting lines cannot loop — people who already report (directly or indirectly) to this employee are not offered as managers.</p>
        {!employee && perms.grantAccess && (
          <label className="flex items-center gap-2 rounded-xl border border-ink-100 px-4 py-3 text-sm text-ink-700 sm:col-span-2 dark:border-ink-800 dark:text-ink-200">
            <input type="checkbox" checked={createLogin} onChange={(e) => setCreateLogin(e.target.checked)} className="h-4 w-4 rounded border-ink-300 text-brand-600" />
            Create a CRM login for this employee next (choose their role, module permissions and credentials)
          </label>
        )}
      </div>
    </Modal>
  )
}
