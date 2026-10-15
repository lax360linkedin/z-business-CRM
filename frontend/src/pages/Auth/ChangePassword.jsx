import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import { Lock, ShieldCheck, ShieldAlert, Eye, EyeOff } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { FormField, Input } from '../../components/common/FormField'
import { Button } from '../../components/common/Button'
import { PasswordStrengthMeter } from './PasswordStrength'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'

function PasswordInput({ show, onToggleShow, ...props }) {
  return (
    <div className="relative">
      <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <Input type={show ? 'text' : 'password'} className="px-9" {...props} />
      <button type="button" onClick={onToggleShow} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600 dark:hover:text-ink-200">
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

export default function ChangePassword() {
  const { register, handleSubmit, watch, reset, setError, formState: { errors } } = useForm()
  const [loading, setLoading] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const { toast } = useToast()
  const { mustChangePassword, updateOwnPassword } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const forced = mustChangePassword || location.state?.forced
  const nextPassword = watch('next')

  const onSubmit = async (data) => {
    setLoading(true)
    try {
      await updateOwnPassword(data.current, data.next)
      toast('Password updated successfully.', { type: 'success' })
      reset()
      if (forced) navigate('/dashboard')
    } catch (err) {
      const field = err.fields?.currentPassword ? 'current' : err.fields?.newPassword ? 'next' : null
      if (err.code === 'INVALID_CURRENT_PASSWORD' || err.code === 'current' || field === 'current') setError('current', { type: 'manual', message: err.message })
      else if (field === 'next') setError('next', { type: 'manual', message: err.message })
      else toast(err.message, { type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Change Password"
        description={forced ? 'You must set a new password before continuing to LAX360 Business CRM.' : 'Update the password used to sign in to your account.'}
      />
      {forced && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>This is a first-time login or an administrator has required a password reset for your account. You won't be able to access other pages until this is complete.</span>
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="mb-2 flex items-center gap-2 text-xs text-ink-500 dark:text-ink-400">
          <ShieldCheck size={14} className="text-brand-600" /> Choose a strong password you don't use elsewhere.
        </div>
        {!forced && (
          <FormField label="Current password" error={errors.current?.message} required>
            <PasswordInput show={showCurrent} onToggleShow={() => setShowCurrent((s) => !s)} {...register('current', { required: 'Required' })} />
          </FormField>
        )}
        <FormField label="New password" error={errors.next?.message} required>
          <PasswordInput
            show={showNext}
            onToggleShow={() => setShowNext((s) => !s)}
            {...register('next', { required: 'Required', minLength: { value: 8, message: 'At least 8 characters' } })}
          />
          <PasswordStrengthMeter password={nextPassword} />
        </FormField>
        <FormField label="Confirm new password" error={errors.confirm?.message} required>
          <PasswordInput
            show={showConfirm}
            onToggleShow={() => setShowConfirm((s) => !s)}
            {...register('confirm', { required: 'Required', validate: (v) => v === watch('next') || 'Passwords do not match' })}
          />
        </FormField>
        <div className="flex justify-end pt-2">
          <Button type="submit" loading={loading}>Update Password</Button>
        </div>
      </form>
    </div>
  )
}
