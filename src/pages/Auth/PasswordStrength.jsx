import { useMemo } from 'react'
import clsx from 'clsx'
import { passwordScore, STRENGTH_LABELS } from '../../utils/password'

const COLORS = ['bg-rose-500', 'bg-amber-500', 'bg-yellow-400', 'bg-emerald-500', 'bg-emerald-400']
const TEXT_COLORS = ['text-rose-500', 'text-amber-500', 'text-yellow-600 dark:text-yellow-400', 'text-emerald-600 dark:text-emerald-400', 'text-emerald-600 dark:text-emerald-400']

/** Theme-aware password strength meter for pages rendered inside the app shell (light/dark toggle). */
export function PasswordStrengthMeter({ password }) {
  const score = useMemo(() => passwordScore(password), [password])
  if (!password) return null
  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={clsx('h-1.5 flex-1 rounded-full transition-colors', i <= score ? COLORS[score] : 'bg-ink-100 dark:bg-ink-800')} />
        ))}
      </div>
      <p className={clsx('mt-1.5 text-xs font-medium', TEXT_COLORS[score])}>{STRENGTH_LABELS[score]}</p>
    </div>
  )
}
