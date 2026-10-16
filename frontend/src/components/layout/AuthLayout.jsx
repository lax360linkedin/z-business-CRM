import { useMemo } from 'react'
import { Outlet, Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Sun, Moon, Users, TrendingUp, FolderKanban, BarChart3 } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { BrandImg } from '../common/Logo'

const FEATURES = [
  { icon: Users, label: 'Leads' },
  { icon: TrendingUp, label: 'Sales' },
  { icon: FolderKanban, label: 'Projects' },
  { icon: BarChart3, label: 'Reports' },
]

function useParticles(count) {
  return useMemo(
    () =>
      Array.from({ length: count }).map((_, i) => ({
        id: i,
        left: `${Math.round((i * 137.5) % 100)}%`,
        size: 2 + ((i * 7) % 4),
        duration: 14 + ((i * 5) % 10),
        delay: (i * 1.7) % 8,
      })),
    [count],
  )
}

function FloatingParticles() {
  const particles = useParticles(16)
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute bottom-0 rounded-full bg-brand-300/40"
          style={{ left: p.left, width: p.size, height: p.size }}
          animate={{ y: ['0vh', '-100vh'], opacity: [0, 0.6, 0.6, 0] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'linear' }}
        />
      ))}
    </div>
  )
}

export function AuthLayout() {
  const { theme, toggleTheme } = useTheme()
  const reduceMotion = useReducedMotion()

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b0713] px-4 py-10">
      {/* Ambient animated glow blobs */}
      <motion.div
        className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-brand-700/25 blur-[110px]"
        animate={reduceMotion ? undefined : { x: [0, 40, -10, 0], y: [0, 25, -15, 0], scale: [1, 1.08, 0.97, 1] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-brand-600/20 blur-[100px]"
        animate={reduceMotion ? undefined : { x: [0, -30, 15, 0], y: [0, -20, 20, 0], scale: [1, 0.95, 1.06, 1] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-brand-400/10 blur-[100px]"
        animate={reduceMotion ? undefined : { x: [0, 25, -20, 0], y: [0, -15, 10, 0] }}
        transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Subtle drifting grid */}
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
        animate={reduceMotion ? undefined : { backgroundPosition: ['0px 0px', '48px 48px'] }}
        transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
      />

      {!reduceMotion && <FloatingParticles />}

      <div className="absolute right-6 top-6 z-20">
        <button
          onClick={toggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>

      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="grid w-full overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/50 lg:grid-cols-2"
        >
          {/* Branding panel */}
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
            className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-700 via-brand-900 to-[#1a0f33] p-10 text-white lg:flex"
          >
            <motion.div
              className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-white/10 blur-3xl"
              animate={reduceMotion ? undefined : { scale: [1, 1.12, 1], opacity: [0.6, 0.9, 0.6] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.div
              className="pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-brand-300/10 blur-3xl"
              animate={reduceMotion ? undefined : { scale: [1, 1.15, 1], opacity: [0.5, 0.85, 0.5] }}
              transition={{ duration: 9, delay: 1, repeat: Infinity, ease: 'easeInOut' }}
            />

            <Link to="/login" className="relative z-10 flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white p-1.5 shadow-lg">
                <BrandImg className="h-full w-full object-contain" />
              </span>
              <span className="leading-tight">
                <span className="block text-lg font-bold tracking-tight">LAX360</span>
                <span className="block text-[11px] font-medium uppercase tracking-wider text-brand-200">Business CRM</span>
              </span>
            </Link>

            <div className="relative z-10 space-y-7">
              <div>
                <h2 className="text-2xl font-bold leading-snug">LAX360 Business CRM</h2>
                <p className="mt-2 text-sm text-brand-100/85">Manage your business. Grow your success.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {FEATURES.map((f) => (
                  <div key={f.label} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                      <f.icon size={15} />
                    </span>
                    <span className="text-sm font-medium">{f.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="relative z-10 text-xs leading-relaxed text-brand-100/70">
              Manage your leads, sales, customers and business operations from one place.
            </p>
          </motion.div>

          {/* Login / form panel */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
            className="flex flex-col justify-center bg-[#120c22] px-6 py-10 sm:px-10 lg:py-12"
          >
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-7 lg:hidden">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white p-1.5 shadow-lg">
                  <BrandImg className="h-full w-full object-contain" />
                </span>
              </div>
              <Outlet />
            </div>
          </motion.div>
        </motion.div>

        <p className="relative z-10 mt-6 text-center text-xs text-white/35">© 2026 LAX360 Pvt Ltd. All rights reserved.</p>
      </div>
    </div>
  )
}
