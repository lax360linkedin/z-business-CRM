import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Catches an error thrown while a screen renders, so one broken page shows a clear message with a way out instead of unmounting the whole app (a blank white screen).
 * It resets by itself when `resetKey` changes (the layout passes the current URL), so moving to another page always starts clean.
 * The technical message is shown only while developing; people get a plain explanation.
 */
export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('A screen failed to render:', error, info?.componentStack)
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-card dark:border-rose-900/50 dark:bg-ink-900">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-900/30"><AlertTriangle size={22} /></span>
        <h2 className="mt-4 text-lg font-semibold text-ink-900 dark:text-ink-50">This page could not be shown</h2>
        <p className="mt-2 text-sm text-ink-500">Something unexpected went wrong while drawing it. Your data is safe. Try again, or open another page from the menu.</p>
        {import.meta.env.DEV && <p className="mt-3 break-words rounded-lg bg-ink-50 px-3 py-2 text-left font-mono text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">{String(error?.message || error)}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" onClick={() => this.setState({ error: null })} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"><RefreshCw size={14} />Try again</button>
          <a href="/dashboard" className="inline-flex items-center rounded-lg border border-ink-200 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800">Go to dashboard</a>
        </div>
      </div>
    )
  }
}
