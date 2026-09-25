import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Camera, RefreshCw } from 'lucide-react'
import { Modal } from '../../components/common/Modal'
import { FormField, Input, Select } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { Avatar } from '../../components/common/Avatar'
import { getEffectiveRoles, DEPARTMENTS, USER_ACCOUNT_STATUSES } from '../../data/constants'
import { USERS } from '../../data/users'
import { genTempPassword } from '../../utils/password'

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

export function AddUserModal({ open, onClose, onSubmit, loading }) {
  const ROLES = getEffectiveRoles()
  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm({
    defaultValues: { role: 'Sales Executive', department: 'Sales', status: 'Pending', tempPassword: genTempPassword(), sendWelcomeEmail: true, forcePasswordChange: true },
  })
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true)
  const [forcePasswordChange, setForcePasswordChange] = useState(true)
  const firstName = watch('firstName')
  const lastName = watch('lastName')

  useEffect(() => {
    if (open) {
      reset({ role: 'Sales Executive', department: 'Sales', status: 'Pending', tempPassword: genTempPassword() })
      setSendWelcomeEmail(true)
      setForcePasswordChange(true)
    }
  }, [open])

  const submit = (data) => onSubmit({ ...data, sendWelcomeEmail, forcePasswordChange })
  const regenerate = () => setValue('tempPassword', genTempPassword())

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add User"
      description="Create a new system login account for LAX360 Business CRM."
      size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit(submit)} loading={loading}>Create User</Button>
      </>}
    >
      <form onSubmit={handleSubmit(submit)} className="space-y-6">
        <div>
          <SectionHeading>Basic Information</SectionHeading>
          <div className="mb-4 flex items-center gap-4">
            <Avatar name={`${firstName || 'New'} ${lastName || 'User'}`} size="lg" />
            <Button type="button" variant="secondary" size="sm" icon={Camera}>Upload Profile Photo</Button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="First Name" required error={errors.firstName?.message}>
              <Input {...register('firstName', { required: 'Required' })} />
            </FormField>
            <FormField label="Last Name" required error={errors.lastName?.message}>
              <Input {...register('lastName', { required: 'Required' })} />
            </FormField>
            <FormField label="Email" required error={errors.email?.message}>
              <Input type="email" {...register('email', { required: 'Required' })} />
            </FormField>
            <FormField label="Phone" required error={errors.phone?.message}>
              <Input {...register('phone', { required: 'Required' })} />
            </FormField>
          </div>
        </div>

        <div className="border-t border-ink-100 pt-5 dark:border-ink-800">
          <SectionHeading>Account Information</SectionHeading>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Username" required error={errors.username?.message}>
              <Input {...register('username', { required: 'Required' })} />
            </FormField>
            <FormField label="Linked Employee">
              <Select {...register('employeeId')}>
                <option value="">Not linked</option>
                {USERS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Role" required>
              <Select {...register('role', { required: true })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </FormField>
            <FormField label="Department" required>
              <Select {...register('department', { required: true })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </FormField>
            <FormField label="Account Status" required className="col-span-2">
              <Select {...register('status', { required: true })}>
                {USER_ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </FormField>
          </div>
        </div>

        <div className="border-t border-ink-100 pt-5 dark:border-ink-800">
          <SectionHeading>Security</SectionHeading>
          <FormField label="Temporary Password" required>
            <div className="flex gap-2">
              <Input {...register('tempPassword', { required: 'Required' })} className="flex-1" />
              <Button type="button" variant="secondary" icon={RefreshCw} onClick={regenerate}>Regenerate</Button>
            </div>
          </FormField>
          <div className="mt-3 space-y-2.5">
            <div className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
              <div>
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Send welcome email</p>
                <p className="text-xs text-ink-400">Emails the temporary password and login link to the user.</p>
              </div>
              <Toggle checked={sendWelcomeEmail} onChange={setSendWelcomeEmail} />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-ink-100 px-4 py-3 dark:border-ink-800">
              <div>
                <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Force password change on first login</p>
                <p className="text-xs text-ink-400">The user must set a new password before accessing the CRM.</p>
              </div>
              <Toggle checked={forcePasswordChange} onChange={setForcePasswordChange} />
            </div>
          </div>
        </div>
      </form>
    </Modal>
  )
}
