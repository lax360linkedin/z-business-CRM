import { AlertTriangle } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'

export function ConfirmDialog({ open, onClose, onConfirm, title = 'Are you sure?', description, confirmLabel = 'Confirm', tone = 'danger', loading = false }) {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="flex gap-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone === 'danger' ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400' : 'bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-400'}`}>
          <AlertTriangle size={20} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-ink-900 dark:text-ink-50">{title}</h3>
          {description && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
