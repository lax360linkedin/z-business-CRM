import clsx from 'clsx'

const baseInput = 'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 disabled:cursor-not-allowed disabled:opacity-60'

export function FormField({ label, error, hint, required, children, className }) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-sm font-medium text-ink-700 dark:text-ink-200">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs text-rose-500">{error}</p> : hint ? <p className="text-xs text-ink-400">{hint}</p> : null}
    </div>
  )
}

export function Input({ className, error, ...props }) {
  return <input className={clsx(baseInput, error && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20', className)} {...props} />
}

export function Textarea({ className, error, ...props }) {
  return <textarea className={clsx(baseInput, 'min-h-[90px] resize-y', error && 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20', className)} {...props} />
}

export function Select({ className, error, children, ...props }) {
  return (
    <select className={clsx(baseInput, 'appearance-none bg-[url(\'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%2394a3b8%22%3E%3Cpath fill-rule=%22evenodd%22 d=%22M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z%22 clip-rule=%22evenodd%22/%3E%3C/svg%3E\')] bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9', error && 'border-rose-400', className)} {...props}>
      {children}
    </select>
  )
}

export function DateInput(props) {
  return <Input type="date" {...props} />
}
