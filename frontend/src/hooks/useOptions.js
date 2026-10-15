import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, onWrite } from '../api/http'

// The configurable dropdown / filter values (industries, cities, enquiry types, reasons, ticket categories ...). They live on the server and are managed by the Super Admin in
// Settings -> Dropdown Options; every screen reads them through these hooks, so a value added, renamed, switched off or reordered there is what the next form and filter show.
// There is no built-in copy in the app: while the lists load or cannot be loaded the pickers say so instead of offering stale choices.
const EVT = 'crm:options-changed'
export const emitOptionsChanged = () => window.dispatchEvent(new Event(EVT))
onWrite((config) => { if (/\/options(\/|\?|$)/.test(String(config?.url || ''))) emitOptionsChanged() })

const errorOf = (e) => e?.response?.data?.message || (e?.code === 'ERR_NETWORK' ? 'Cannot reach the server.' : e?.message) || 'Could not load the options.'

/** Every list with its items. Shared by all callers within a moment (the HTTP client merges identical reads). */
export function useOptionLists() {
  const [state, setState] = useState({ lists: null, error: '' })
  const load = useCallback(() => api.get('/options')
    .then((r) => setState({ lists: r.data.lists, error: '' }))
    .catch((e) => setState((s) => ({ lists: s.lists, error: errorOf(e) }))), [])
  useEffect(() => {
    load()
    window.addEventListener(EVT, load)
    window.addEventListener('focus', load)
    return () => { window.removeEventListener(EVT, load); window.removeEventListener('focus', load) }
  }, [load])
  return { lists: state.lists, loading: state.lists === null && !state.error, error: state.error, reload: load }
}

/**
 * One list for a picker or a filter.
 *  values      - the options a NEW record may take (active ones), plus `current` (the record's own value, even if it has since been switched off, so editing never blanks it);
 *  all         - every value including switched-off ones, for FILTERS (old records may still carry them);
 *  placeholder - the text of the empty first option: it says what is going on while there is nothing to choose.
 */
export function useOptions(key, current) {
  const { lists, loading, error, reload } = useOptionLists()
  return useMemo(() => {
    const items = lists?.[key]?.items || []
    const active = items.filter((i) => i.active).map((i) => i.value)
    const currents = [].concat(current ?? []).filter(Boolean)
    const values = [...active, ...currents.filter((c) => !active.includes(c))]
    const all = [...items.map((i) => i.value), ...currents.filter((c) => !items.some((i) => i.value === c))]
    const empty = !loading && !error && !active.length
    const placeholder = loading ? 'Loading options…' : error && !items.length ? 'Could not load — check your connection' : empty ? 'No options configured' : 'Select…'
    return { values, all, items, loading, error, empty, placeholder, reload }
  }, [lists, loading, error, key, current, reload])
}

/** `{ value, label }` pairs for the schema-driven forms / filter panels. */
export const asChoices = (values) => values.map((v) => ({ value: v, label: v }))
