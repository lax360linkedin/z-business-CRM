import { useState } from 'react'
import clsx from 'clsx'
import { DEFAULT_LOGO_SRC, useBranding } from '../../hooks/useBranding'

/** The company logo <img>: the one the Super Admin uploaded in Settings, or the built-in one (also used if the uploaded file cannot be loaded). */
export function BrandImg({ className, alt = 'Company logo' }) {
  const { src, version } = useBranding()
  const [failed, setFailed] = useState(null) // the version that failed to load
  const broken = failed !== null && failed === version
  return <img src={broken ? DEFAULT_LOGO_SRC : src} alt={alt} className={className} onError={() => { if (!broken && src !== DEFAULT_LOGO_SRC) setFailed(version) }} />
}

export function Logo({ className, imgClassName }) {
  return (
    <span className={clsx('inline-flex items-center', className)}>
      <BrandImg className={clsx('h-9 w-auto object-contain', imgClassName)} />
    </span>
  )
}

export const LOGO_SRC = DEFAULT_LOGO_SRC
