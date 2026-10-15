import { Clock } from 'lucide-react'
import { Modal } from '../common/Modal'
import { Button } from '../common/Button'
import { useAuth } from '../../context/AuthContext'
import { useIdleSession } from '../../hooks/useIdleSession'

/**
 * Mounted once for every signed-in screen. Watches for real activity (see useIdleSession) and, after the configured period of none, signs the person out and sends them to the
 * login page with the reason. A minute before that it asks "Still there?" so nobody is surprised - and so an open form can be saved first.
 */
export function IdleGuard() {
  const { user, logout } = useAuth()
  const { warning, stay } = useIdleSession({ enabled: !!user, idleMinutes: user?.idleTimeoutMinutes, onIdle: () => logout('idle') })
  return (
    <Modal
      open={!!warning}
      onClose={stay}
      size="sm"
      title="Are you still there?"
      footer={<><Button variant="ghost" onClick={() => logout()}>Sign out now</Button><Button onClick={stay}>Stay signed in</Button></>}
    >
      <div className="flex items-start gap-3 text-sm text-ink-600 dark:text-ink-300" role="alertdialog" aria-live="assertive">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/30"><Clock size={18} /></span>
        <div>
          <p>There has been no activity for a while, so for your security you will be signed out in <b className="tabular-nums text-ink-900 dark:text-ink-50">{warning?.secondsLeft ?? 0} seconds</b>.</p>
          {warning?.unsaved && <p className="mt-2 font-medium text-amber-700 dark:text-amber-400">A form is open with text typed in. Choose “Stay signed in” and save it, or it will be lost.</p>}
        </div>
      </div>
    </Modal>
  )
}
