import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, ArrowLeft, CheckCircle2, Lock, Eye, EyeOff } from 'lucide-react'
import { AuthField, AuthInput, AuthButton, PasswordStrengthMeter } from './AuthFormControls'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

/**
 * Forgot Password is a single verified flow, not a link to a separately-reachable page:
 * email -> OTP -> new password -> done. Keeping the new-password step gated behind a
 * verified OTP (rather than a standalone /reset-password route anyone could navigate to
 * directly) is the whole point of the OTP requirement — a bare route would defeat it.
 */
export default function ForgotPassword() {
  const [step, setStep] = useState('email') // 'email' | 'sent' | 'newPassword' | 'done'
  const [devToken, setDevToken] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const { requestPasswordReset, resetPassword } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const emailForm = useForm()
  const passwordForm = useForm()
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const newPassword = passwordForm.watch('password')

  const submitEmail = async (data) => {
    setSending(true)
    setError('')
    try {
      const res = await requestPasswordReset(data.email)
      setEmail(data.email)
      setDevToken(res.devResetToken || '')
      // the server answers the same whether or not the account exists, so this page never reveals it
      setStep('sent')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const submitNewPassword = async (data) => {
    setSaving(true)
    setError('')
    try {
      await resetPassword(token, data.password)
      setStep('done')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (step === 'sent') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 className="text-2xl font-bold tracking-tight text-white">Check with your administrator</h1>
        <p className="mt-2 text-sm text-white/60">
          If an account exists for <span className="text-white/80">{email}</span>, a password reset has been prepared. Reset links are sent by e-mail once an e-mail service is connected to this workspace;
          until then your Super Admin can issue you a new temporary password from User Management.
        </p>
        {devToken && (
          <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <p className="font-medium">Development mode</p>
            <p className="mt-1 text-amber-200/80">The server is running in debug mode, so the reset code is shown here instead of being e-mailed.</p>
            <button type="button" onClick={() => { setToken(devToken); setStep('newPassword') }} className="mt-3 inline-flex h-9 items-center rounded-lg bg-amber-500/20 px-4 font-medium text-amber-100 hover:bg-amber-500/30">
              Continue with this code
            </button>
          </div>
        )}
        <Link to="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-white/60 hover:text-white/90"><ArrowLeft size={15} /> Back to login</Link>
      </motion.div>
    )
  }

  if (step === 'newPassword') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 className="text-2xl font-bold tracking-tight text-white">Set a new password</h1>
        <p className="mt-1.5 text-sm text-white/50">Choose a strong password you do not use elsewhere.</p>
        {error && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}

        <form onSubmit={passwordForm.handleSubmit(submitNewPassword)} className="mt-7 space-y-4">
          <AuthField label="New Password" error={passwordForm.formState.errors.password?.message}>
            <AuthInput
              icon={Lock}
              type={showPw ? 'text' : 'password'}
              placeholder="Enter your password"
              error={passwordForm.formState.errors.password?.message}
              endAdornment={
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
              {...passwordForm.register('password', { required: 'Password is required', minLength: { value: 8, message: 'At least 8 characters' } })}
            />
            <PasswordStrengthMeter password={newPassword} />
          </AuthField>

          <AuthField label="Confirm Password" error={passwordForm.formState.errors.confirm?.message}>
            <AuthInput
              icon={Lock}
              type={showConfirm ? 'text' : 'password'}
              placeholder="Re-enter your password"
              error={passwordForm.formState.errors.confirm?.message}
              endAdornment={
                <button type="button" onClick={() => setShowConfirm((s) => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
              {...passwordForm.register('confirm', { required: 'Please confirm your password', validate: (v) => v === passwordForm.watch('password') || 'Passwords do not match' })}
            />
          </AuthField>

          <AuthButton loading={saving}>{saving ? 'Resetting...' : 'Reset Password'}</AuthButton>
        </form>
      </motion.div>
    )
  }

  if (step === 'done') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
          <CheckCircle2 size={26} />
        </div>
        <h1 className="text-xl font-bold text-white">Password reset</h1>
        <p className="mt-2 text-sm text-white/50">Your password has been updated. Please sign in with your new password.</p>
        <button
          onClick={() => { toast('Password reset successfully. Please sign in.', { type: 'success' }); navigate('/login') }}
          className="mt-6 inline-flex h-10 items-center rounded-xl border border-white/15 px-5 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 hover:text-white"
        >
          Continue to sign in
        </button>
      </motion.div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.2 }}>
      <Link to="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-white/50 hover:text-white/80">
        <ArrowLeft size={15} /> Back to login
      </Link>
      <h1 className="text-2xl font-bold tracking-tight text-white">Forgot Password</h1>
      <p className="mt-1.5 text-sm text-white/50">Enter your email address or username and we'll prepare a password reset.</p>
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</p>}

      <form onSubmit={emailForm.handleSubmit(submitEmail)} className="mt-7 space-y-4">
        <AuthField label="Email or username" error={emailForm.formState.errors.email?.message}>
          <AuthInput
            icon={Mail}
            type="text"
            placeholder="Enter your email or username"
            error={emailForm.formState.errors.email?.message}
            {...emailForm.register('email', { required: 'Email or username is required' })}
          />
        </AuthField>
        <AuthButton loading={sending}>{sending ? 'Sending...' : 'Request Password Reset'}</AuthButton>
      </form>
    </motion.div>
  )
}
