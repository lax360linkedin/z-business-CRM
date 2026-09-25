import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, Eye, EyeOff, AlertTriangle, Clock } from 'lucide-react'
import { RoleSelect } from '../../components/common/RoleSelect'
import { AuthField, AuthInput, AuthCheckbox, AuthButton } from './AuthFormControls'
import { OtpStep } from './OtpStep'
import { useAuth, consumeExpiredFlag, lookupAssignableRoles } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getEffectiveRoles } from '../../data/constants'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const { register, handleSubmit, control, setError, clearErrors, watch, formState: { errors } } = useForm({ defaultValues: { role: '', email: '', password: '' } })
  const { authenticate, completeMfaLogin } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [showPw, setShowPw] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState(null)
  const [expired, setExpired] = useState(false)
  const [assignableRoles, setAssignableRoles] = useState(null)
  const [mfaChallenge, setMfaChallenge] = useState(null) // { accountId, role, rememberMe, email }

  const email = watch('email')

  useEffect(() => {
    if (consumeExpiredFlag()) setExpired(true)
  }, [])

  // Multi-role support: once we recognize the entered email, narrow the role dropdown to
  // only the role(s) actually assigned to that account — never show roles the user isn't
  // allowed to select. Unrecognized emails keep the full list, since we can't know who they
  // are yet and shouldn't leak whether an email exists via the dropdown contents.
  useEffect(() => {
    const id = setTimeout(() => setAssignableRoles(lookupAssignableRoles(email)), 300)
    return () => clearTimeout(id)
  }, [email])

  const onSubmit = (data) => {
    setFormError(null)
    setExpired(false)
    clearErrors('role')
    setLoading(true)
    setTimeout(() => {
      try {
        const result = authenticate(data.email, data.password, data.role, rememberMe)
        if (result?.mfaRequired) {
          setMfaChallenge({ ...result, email: data.email })
        } else {
          toast(`Welcome back, ${result.name.split(' ')[0]}!`, { type: 'success' })
          navigate('/dashboard')
        }
      } catch (err) {
        if (err.code === 'role') setError('role', { type: 'manual', message: err.message })
        else setFormError(err.message)
      } finally {
        setLoading(false)
      }
    }, 500)
  }

  if (mfaChallenge) {
    return (
      <OtpStep
        purpose="mfa"
        subjectId={mfaChallenge.accountId}
        contactLabel={mfaChallenge.email}
        title="Two-factor verification"
        onBack={() => setMfaChallenge(null)}
        onVerified={() => {
          const signedInUser = completeMfaLogin(mfaChallenge.accountId, mfaChallenge.role, mfaChallenge.rememberMe)
          toast(`Welcome back, ${signedInUser.name.split(' ')[0]}!`, { type: 'success' })
          navigate('/dashboard')
        }}
      />
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.2 }}>
      <h1 className="text-2xl font-bold tracking-tight text-white">Welcome Back</h1>
      <p className="mt-1.5 text-sm text-white/50">Sign in to continue to LAX360 Business CRM</p>

      <AnimatePresence>
        {expired && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 flex items-start gap-2.5 overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
          >
            <Clock size={16} className="mt-0.5 shrink-0" />
            <span>Your session has expired. Please sign in again.</span>
          </motion.div>
        )}
        {formError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 flex items-start gap-2.5 overflow-hidden rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{formError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4">
        <AuthField label="Role">
          <Controller
            name="role"
            control={control}
            rules={{ required: 'Please select your role' }}
            render={({ field }) => (
              <RoleSelect value={field.value} onChange={field.onChange} options={assignableRoles || getEffectiveRoles()} error={errors.role?.message} />
            )}
          />
        </AuthField>

        <AuthField label="Email" error={errors.email?.message}>
          <AuthInput
            icon={Mail}
            type="email"
            placeholder="Enter your email"
            error={errors.email?.message}
            {...register('email', { required: 'Email is required', pattern: { value: EMAIL_PATTERN, message: 'Enter a valid email address' } })}
          />
        </AuthField>

        <AuthField label="Password" error={errors.password?.message}>
          <AuthInput
            icon={Lock}
            type={showPw ? 'text' : 'password'}
            placeholder="Enter your password"
            error={errors.password?.message}
            endAdornment={
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
            {...register('password', { required: 'Password is required' })}
          />
        </AuthField>

        <div className="flex items-center justify-between">
          <AuthCheckbox checked={rememberMe} onChange={setRememberMe} label="Remember me" />
          <Link to="/forgot-password" className="text-sm font-medium text-brand-300 hover:text-brand-200">Forgot Password?</Link>
        </div>

        <AuthButton loading={loading}>{loading ? 'Signing in...' : 'Sign In'}</AuthButton>
      </form>
    </motion.div>
  )
}
