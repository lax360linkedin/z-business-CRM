import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, ShieldCheck, RefreshCw, Info } from 'lucide-react'
import { AuthButton } from './AuthFormControls'
import { startOtp, verifyOtp, getOtpState, OTP_EXPIRY_MS, OTP_RESEND_COOLDOWN_MS } from '../../utils/otp'

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Shared OTP entry step for both login MFA and Forgot Password reset flows. Purely a mock —
 * there's no email/SMS backend, so the generated code is shown on-screen behind a clearly
 * labeled "Demo Mode" banner instead of pretending it was delivered.
 */
export function OtpStep({ purpose, subjectId, contactLabel, title, description, onVerified, onBack }) {
  const [digits, setDigits] = useState(Array(6).fill(''))
  const [demoCode, setDemoCode] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [resendCooldownUntil, setResendCooldownUntil] = useState(Date.now() + OTP_RESEND_COOLDOWN_MS)
  const inputRefs = useRef([])

  const send = () => {
    const code = startOtp(purpose, subjectId)
    setDemoCode(code)
    setDigits(Array(6).fill(''))
    setError('')
    setResendCooldownUntil(Date.now() + OTP_RESEND_COOLDOWN_MS)
    inputRefs.current[0]?.focus()
  }

  useEffect(() => { send() }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const state = getOtpState(purpose, subjectId)
  const expiresAt = state?.expiresAt ?? now
  const expired = now > expiresAt
  const canResend = now >= resendCooldownUntil

  const handleDigitChange = (idx, value) => {
    const v = value.replace(/\D/g, '').slice(-1)
    setDigits((d) => {
      const next = [...d]
      next[idx] = v
      return next
    })
    if (v && idx < 5) inputRefs.current[idx + 1]?.focus()
  }

  const handleKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) inputRefs.current[idx - 1]?.focus()
  }

  const handlePaste = (e) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    e.preventDefault()
    setDigits(Array.from({ length: 6 }, (_, i) => text[i] || ''))
    inputRefs.current[Math.min(text.length, 5)]?.focus()
  }

  const submit = () => {
    const entered = digits.join('')
    if (entered.length !== 6) {
      setError('Please enter the complete 6-digit code.')
      return
    }
    setVerifying(true)
    setTimeout(() => {
      const result = verifyOtp(purpose, subjectId, entered)
      setVerifying(false)
      if (result.ok) {
        onVerified()
        return
      }
      if (result.code === 'expired') setError('OTP has expired. Please request a new verification code.')
      else if (result.code === 'too_many_attempts') setError('Too many incorrect attempts. Please request a new verification code.')
      else setError('Invalid OTP. Please enter the correct verification code.')
      setDigits(Array(6).fill(''))
      inputRefs.current[0]?.focus()
    }, 450)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      {onBack && (
        <button onClick={onBack} className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-white/50 hover:text-white/80">
          <ArrowLeft size={15} /> Back
        </button>
      )}
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck size={20} className="text-brand-300" />
        <h1 className="text-2xl font-bold tracking-tight text-white">{title || 'Verify your identity'}</h1>
      </div>
      <p className="mt-1.5 text-sm text-white/50">{description || <>Enter the 6-digit code sent to <span className="text-white/70">{contactLabel}</span>.</>}</p>

      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span><span className="font-semibold">Demo Mode</span> — no real email is sent in this frontend-only build. Your verification code is <span className="font-mono text-sm font-bold text-amber-200">{demoCode}</span>.</span>
      </div>

      <div className="mt-6 flex justify-between gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => (inputRefs.current[i] = el)}
            value={d}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            inputMode="numeric"
            maxLength={1}
            className="h-14 w-11 rounded-xl border border-white/10 bg-white/[0.04] text-center text-xl font-semibold text-white transition-all focus:border-brand-400/70 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
          />
        ))}
      </div>

      {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
      {!error && expired && <p className="mt-3 text-xs text-amber-400">OTP has expired. Please request a new verification code.</p>}

      <div className="mt-4 flex items-center justify-between text-xs text-white/40">
        <span>{expired ? 'Code expired' : `Expires in ${formatCountdown(expiresAt - now)}`}</span>
        <button
          type="button"
          onClick={send}
          disabled={!canResend}
          className="flex items-center gap-1.5 font-medium text-brand-300 hover:text-brand-200 disabled:cursor-not-allowed disabled:text-white/25"
        >
          <RefreshCw size={12} /> {canResend ? 'Resend OTP' : `Resend in ${formatCountdown(resendCooldownUntil - now)}`}
        </button>
      </div>

      <div className="mt-6">
        <AuthButton loading={verifying} onClick={(e) => { e.preventDefault(); submit() }}>
          {verifying ? 'Verifying...' : 'Verify & Continue'}
        </AuthButton>
      </div>
    </motion.div>
  )
}
