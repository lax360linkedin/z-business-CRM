import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { motion } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, ArrowLeft, CheckCircle2, Lock, Eye, EyeOff } from 'lucide-react'
import { AuthField, AuthInput, AuthButton, PasswordStrengthMeter } from './AuthFormControls'
import { OtpStep } from './OtpStep'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Forgot Password is a single verified flow, not a link to a separately-reachable page:
 * email -> OTP -> new password -> done. Keeping the new-password step gated behind a
 * verified OTP (rather than a standalone /reset-password route anyone could navigate to
 * directly) is the whole point of the OTP requirement — a bare route would defeat it.
 */
export default function ForgotPassword() {
  const [step, setStep] = useState('email') // 'email' | 'otp' | 'newPassword' | 'done'
  const [email, setEmail] = useState('')
  const { resetPassword } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const emailForm = useForm()
  const passwordForm = useForm()
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const newPassword = passwordForm.watch('password')

  const submitEmail = (data) => {
    setSending(true)
    setTimeout(() => {
      setSending(false)
      setEmail(data.email)
      // Generic message either way — never reveal whether the email exists.
      setStep('otp')
    }, 600)
  }

  const submitNewPassword = (data) => {
    setSaving(true)
    setTimeout(() => {
      setSaving(false)
      resetPassword(email, data.password)
      setStep('done')
    }, 600)
  }

  if (step === 'otp') {
    return (
      <OtpStep
        purpose="reset"
        subjectId={email.toLowerCase()}
        contactLabel={email}
        title="Verify it's you"
        description={<>If an account exists for <span className="text-white/70">{email}</span>, we've sent a code to it.</>}
        onBack={() => setStep('email')}
        onVerified={() => setStep('newPassword')}
      />
    )
  }

  if (step === 'newPassword') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 className="text-2xl font-bold tracking-tight text-white">Set a new password</h1>
        <p className="mt-1.5 text-sm text-white/50">Your new password must be different from previous passwords.</p>

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
      <p className="mt-1.5 text-sm text-white/50">Enter your email address and we'll send you a verification code.</p>

      <form onSubmit={emailForm.handleSubmit(submitEmail)} className="mt-7 space-y-4">
        <AuthField label="Email" error={emailForm.formState.errors.email?.message}>
          <AuthInput
            icon={Mail}
            type="email"
            placeholder="Enter your email"
            error={emailForm.formState.errors.email?.message}
            {...emailForm.register('email', { required: 'Email is required', pattern: { value: EMAIL_PATTERN, message: 'Enter a valid email address' } })}
          />
        </AuthField>
        <AuthButton loading={sending}>{sending ? 'Sending...' : 'Send Verification Code'}</AuthButton>
      </form>
    </motion.div>
  )
}
