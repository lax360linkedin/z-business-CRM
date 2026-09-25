import { forwardRef, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Check } from 'lucide-react'
import clsx from 'clsx'
import { passwordScore } from '../../utils/password'

export function AuthField({ label, error, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-white/80">{label}</label>}
      {children}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  )
}

export const AuthInput = forwardRef(function AuthInput({ icon: Icon, error, className, endAdornment, ...props }, ref) {
  return (
    <div className="relative">
      {Icon && <Icon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-300/70" />}
      <input
        ref={ref}
        className={clsx(
          'h-11 w-full rounded-xl border bg-white/[0.04] text-sm text-white placeholder:text-white/30 transition-all focus:outline-none focus:ring-2',
          Icon ? 'pl-10' : 'pl-3.5',
          endAdornment ? 'pr-10' : 'pr-3.5',
          error ? 'border-rose-500/60 focus:border-rose-500 focus:ring-rose-500/20' : 'border-white/10 hover:border-white/20 focus:border-brand-400/70 focus:ring-brand-500/25',
          className,
        )}
        {...props}
      />
      {endAdornment}
    </div>
  )
})

export function AuthCheckbox({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white/60 select-none">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={clsx(
          'flex h-4.5 h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border transition-colors',
          checked ? 'border-brand-500 bg-gradient-to-br from-brand-500 to-brand-600' : 'border-white/20 bg-white/[0.04] hover:border-white/35',
        )}
      >
        {checked && <Check size={12} strokeWidth={3} className="text-white" />}
      </button>
      {label}
    </label>
  )
}

export function AuthButton({ children, loading, className, ...props }) {
  return (
    <motion.button
      type="submit"
      whileHover={{ scale: loading ? 1 : 1.01 }}
      whileTap={{ scale: loading ? 1 : 0.98 }}
      disabled={loading}
      className={clsx(
        'flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-700 text-sm font-semibold text-white shadow-lg shadow-brand-900/40 transition-shadow hover:shadow-brand-700/40 disabled:cursor-not-allowed disabled:opacity-70',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </motion.button>
  )
}

const STRENGTH_LEVELS = [
  { label: 'Too weak', color: 'bg-rose-500', textColor: 'text-rose-400' },
  { label: 'Weak', color: 'bg-amber-500', textColor: 'text-amber-400' },
  { label: 'Fair', color: 'bg-yellow-400', textColor: 'text-yellow-300' },
  { label: 'Strong', color: 'bg-emerald-500', textColor: 'text-emerald-400' },
  { label: 'Very strong', color: 'bg-emerald-400', textColor: 'text-emerald-300' },
]

export function PasswordStrengthMeter({ password }) {
  const score = useMemo(() => passwordScore(password), [password])
  const level = STRENGTH_LEVELS[password ? score : -1] || null
  if (!password) return null
  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={clsx('h-1.5 flex-1 rounded-full transition-colors', i <= score ? level.color : 'bg-white/10')} />
        ))}
      </div>
      <p className={clsx('mt-1.5 text-xs font-medium', level.textColor)}>{level.label}</p>
    </div>
  )
}
