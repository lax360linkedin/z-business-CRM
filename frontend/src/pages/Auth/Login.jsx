import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, Eye, EyeOff, AlertTriangle, Clock, MapPin } from 'lucide-react'
import { AuthField, AuthInput, AuthSelect, AuthCheckbox, AuthButton } from './AuthFormControls'
import { useAuth, consumeExpiredFlag, consumeReturnPath } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { getDeviceId } from '../../utils/deviceId'
import { BRANCH_NAMES } from '../../data/branches'
import { preloadPath } from '../../routes/lazyPage'

export default function Login() {
  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: { identifier: '', password: '', branch: '' } })
  const { authenticate } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [showPw, setShowPw] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState(null)
  const [expired, setExpired] = useState(null) // why the last session ended without the person asking: { reason, minutes }

  useEffect(() => {
    const why = consumeExpiredFlag() // read once; in development React runs this effect twice, and the second read must not erase the first
    if (why) setExpired(why)
    preloadPath('/dashboard') // the landing screen's code downloads while the person is still typing their password
  }, [])

  const onSubmit = async (data) => {
    setFormError(null)
    setExpired(null)
    setLoading(true)
    try {
      // Credentials are all it takes: no second verification step, and no role to pick. The account itself carries its role and assigned
      // branch - left on Automatic, the branch is taken from the account (All Branches for the Super Admin); a branch picked here is only checked against it by the server.
      const signedInUser = await authenticate(data.identifier, data.password, rememberMe, getDeviceId(), data.branch)
      toast(`Welcome back, ${signedInUser.name.split(' ')[0]}! ${signedInUser.allBranches ? 'Viewing all branches.' : signedInUser.branch ? `${signedInUser.branch} branch.` : ''}`.trim(), { type: 'success' })
      navigate(consumeReturnPath(signedInUser.accountId) || signedInUser.landingPath || '/dashboard')
    } catch (err) {
      setFormError(err.message)
    } finally {
      setLoading(false)
    }
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
            <span>{expired?.reason === 'idle' ? `You were signed out after ${expired.minutes} minutes of inactivity. Sign in again to continue where you left off.` : expired?.reason === 'revoked' ? 'Your session was ended (you signed out elsewhere, or your access changed). Please sign in again.' : 'Your session has expired. Please sign in again.'}</span>
          </motion.div>
        )}
        {formError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            role="alert"
            className="mt-4 flex items-start gap-2.5 overflow-hidden rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{formError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4">
        <AuthField label="Email or username" error={errors.identifier?.message}>
          <AuthInput
            icon={Mail}
            type="text"
            autoComplete="username"
            placeholder="Enter your email or username"
            error={errors.identifier?.message}
            {...register('identifier', { required: 'Email or username is required' })}
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

        <AuthField label="Branch" error={errors.branch?.message}>
          <AuthSelect icon={MapPin} aria-label="Branch" error={errors.branch?.message} {...register('branch')}>
            <option value="">Automatic (from my account)</option>
            <option value="all">All Branches</option>
            {BRANCH_NAMES.map((b) => <option key={b} value={b}>{b}</option>)}
          </AuthSelect>
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
