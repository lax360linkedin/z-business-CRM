import clsx from 'clsx'
import { initials as getInitials, avatarColor } from '../../utils/avatar'

const SIZES = { xs: 'h-6 w-6 text-[10px]', sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-lg' }

export function Avatar({ name, size = 'md', className, ringed = false }) {
  if (!name) return null
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold',
        SIZES[size],
        avatarColor(name),
        ringed && 'ring-2 ring-white dark:ring-ink-900',
        className,
      )}
      title={name}
    >
      {getInitials(name)}
    </span>
  )
}
