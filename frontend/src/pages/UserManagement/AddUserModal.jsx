import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { RefreshCw, Copy, Eye, EyeOff, CheckCircle2, ShieldCheck } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Select } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { useToast } from '../../context/ToastContext'
import { departmentNames } from '../../utils/orgLookup'
import { USERS } from '../../data/users'
import { genTempPassword } from '../../utils/password'
import { AccessSetup, initialAccess } from './AccessSetup'

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-ink-200 dark:bg-ink-700'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function SectionHeading({ children }) {
  return <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">{children}</p>
}

/** Shown once after an account is created: the login details the Super Admin hands to the person. */
export function CredentialsCard({ account, onClose }) {
  const { toast } = useToast()
  const [show, setShow] = useState(false)
  const text = `LAX360 Business CRM login\nUsername: ${account.username}\nEmail: ${account.email}\nPassword: ${account.password}\nRole: ${account.accessLevel}${account.forcePasswordChange ? '\n(You will be asked to choose a new password at first sign-in.)' : ''}`
  const copy = () => { navigator.clipboard?.writeText(text); toast('Login details copied. Share them with the user privately.', { type: 'success' }) }
  return (
    <Modal open onClose={onClose} size="md" title="Account created" description="Share these login details with the user through a private channel. The password stays visible to you under User Management → Credentials." footer={<><Button variant="secondary" icon={Copy} onClick={copy}>Copy login details</Button><Button onClick={onClose}>Done</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-emerald-600"><CheckCircle2 size={16} /> {account.name} can sign in now - no verification code is needed.</p>
        <dl className="divide-y divide-ink-100 rounded-xl border border-ink-100 dark:divide-ink-800 dark:border-ink-800">
          {[['Name', account.name], ['Username', account.username], ['Email', account.email], ['Role', account.accessLevel]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-2"><dt className="text-ink-500">{k}</dt><dd className="font-medium text-ink-800 dark:text-ink-100">{v}</dd></div>
          ))}
          <div className="flex items-center justify-between gap-4 px-4 py-2">
            <dt className="text-ink-500">Password</dt>
            <dd className="flex items-center gap-2 font-mono font-medium text-ink-800 dark:text-ink-100">{show ? account.password : '•'.repeat(10)}
              <button type="button" onClick={() => setShow((s) => !s)} className="text-ink-400 hover:text-ink-600" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </dd>
          </div>
        </dl>
        {account.forcePasswordChange && <p className="flex items-start gap-2 text-xs text-ink-500"><ShieldCheck size={14} className="mt-0.5 shrink-0" /> They will be asked to choose their own password the first time they sign in.</p>}
      </div>
    </Modal>
  )
}

export function AddUserModal({ open, onClose, onSubmit, loading, preset = null }) {
  const blank = () => ({ department: departmentNames()[0] || 'Sales', password: genTempPassword(), employeeId: '' })
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm({ defaultValues: blank() })
  const [access, setAccess] = useState(() => initialAccess('Employee', 'Employee'))
  const [forcePasswordChange, setForcePasswordChange] = useState(true)
  const [showPw, setShowPw] = useState(true)
  const employeeId = watch('employeeId')

  useEffect(() => {
    if (open) {
      reset(blank())
      setAccess(preset?.level === 'Admin' ? initialAccess('Admin', 'Admin', preset.branch || '') : initialAccess('Employee', 'Employee', preset?.branch || ''))
      setBranchError('')
      setForcePasswordChange(true)
      setShowPw(true)
    }
  }, [open, preset?.branch, preset?.level]) // eslint-disable-line react-hooks/exhaustive-deps

  // choosing an existing employee pre-fills the person's details
  useEffect(() => {
    const e = USERS.find((u) => u.id === employeeId)
    if (!e) return
    const [first, ...rest] = e.name.split(' ')
    setValue('firstName', first); setValue('lastName', rest.join(' ')); setValue('email', e.email); setValue('phone', e.phone || ''); setValue('department', e.department)
    setValue('username', e.email.split('@')[0])
    if (e.branch) setAccess((a) => ({ ...a, branch: e.branch }))
  }, [employeeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const [branchError, setBranchError] = useState('')
  const submit = (data) => {
    if (!access.branch) { setBranchError('Choose the branch this person works in.'); return }
    setBranchError('')
    onSubmit({ ...data, access, forcePasswordChange })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add User"
      description={preset?.level === 'Admin' ? `Add an admin for the ${preset.branch} branch. They run that branch only: its data, its people and the modules you allow.` : 'Create a login for an Admin or Employee, assign them to ONE branch, set exactly which modules they can use, and issue their credentials. Only the Super Admin can do this.'}
      size="xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit(submit)} loading={loading}>Create User</Button>
      </>}
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-6">
        <div>
          <SectionHeading>Employee</SectionHeading>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Link to an existing employee" hint="Optional - pre-fills the details below." className="col-span-2">
              <Select {...register('employeeId')}>
                <option value="">Not linked - new person</option>
                {USERS.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
              </Select>
            </FormField>
            <FormField label="First Name" required error={errors.firstName?.message}>
              <Input {...register('firstName', { required: 'Required' })} />
            </FormField>
            <FormField label="Last Name" required error={errors.lastName?.message}>
              <Input {...register('lastName', { required: 'Required' })} />
            </FormField>
            <FormField label="Email" required error={errors.email?.message}>
              <Input type="email" {...register('email', { required: 'Required', pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email' } })} />
            </FormField>
            <FormField label="Phone" error={errors.phone?.message}>
              <Input {...register('phone')} />
            </FormField>
            <FormField label="Department" required>
              <Select {...register('department', { required: true })}>
                {departmentNames().map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </FormField>
          </div>
        </div>

        <div className="border-t border-ink-100 pt-5 dark:border-ink-800">
          <SectionHeading>Role and module permissions</SectionHeading>
          <AccessSetup value={access} onChange={(v) => { setAccess(v); if (v.branch) setBranchError('') }} />
          {branchError && <p role="alert" className="mt-2 text-xs text-rose-500">{branchError}</p>}
        </div>

        <div className="border-t border-ink-100 pt-5 dark:border-ink-800">
          <SectionHeading>Login credentials</SectionHeading>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Username" required error={errors.username?.message} hint="They can sign in with this or their email.">
              <Input autoComplete="off" {...register('username', { required: 'Required', pattern: { value: /^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/, message: '3-40 letters, numbers, . _ -' } })} />
            </FormField>
            <FormField label="Password" required error={errors.password?.message} hint="Minimum 8 characters. You will be shown it once the account is created.">
              <div className="flex gap-2">
                <Input autoComplete="new-password" type={showPw ? 'text' : 'password'} className="flex-1 font-mono" {...register('password', { required: 'Required', minLength: { value: 8, message: 'At least 8 characters' } })} />
                <Button type="button" variant="secondary" icon={showPw ? EyeOff : Eye} onClick={() => setShowPw((s) => !s)} aria-label="Show or hide password" />
                <Button type="button" variant="secondary" icon={RefreshCw} onClick={() => setValue('password', genTempPassword())}>Generate</Button>
              </div>
            </FormField>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
            <div>
              <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Ask for a new password at first sign-in</p>
              <p className="text-xs text-ink-400">The user must choose their own password before using the CRM.</p>
            </div>
            <Toggle checked={forcePasswordChange} onChange={setForcePasswordChange} />
          </div>
        </div>
      </form>
    </Modal>
  )
}
