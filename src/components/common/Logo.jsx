import logoSrc from '../../assets/lax360-logo.jpeg'
import clsx from 'clsx'

export function Logo({ className, imgClassName }) {
  return (
    <span className={clsx('inline-flex items-center', className)}>
      <img src={logoSrc} alt="LAX360" className={clsx('h-9 w-auto object-contain', imgClassName)} />
    </span>
  )
}

export const LOGO_SRC = logoSrc
