import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Trash2, Check, X } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { BrandImg } from '../../components/common/Logo'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api, errorMessage } from '../../api/http'
import { applyBranding, useBranding } from '../../hooks/useBranding'

const MAX_BYTES = 1024 * 1024
const TYPES = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/svg+xml': 'SVG' }
const EXT = /\.(png|jpe?g|svg)$/i

/** What is wrong with this file, before anything is sent (the server checks again from the file's own bytes). */
export function logoProblem(file) {
  if (!file) return 'Choose an image file.'
  if (!TYPES[file.type] || !EXT.test(file.name)) return 'Only PNG, JPG, JPEG or SVG images can be used as the logo.'
  if (file.size > MAX_BYTES) return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The logo must be 1 MB or smaller.`
  if (file.size === 0) return 'That file is empty.'
  return ''
}

const Tile = ({ dark, children, label }) => (
  <div className="text-center">
    <div className={`flex h-20 w-36 items-center justify-center rounded-xl border p-3 ${dark ? 'border-ink-700 bg-ink-900' : 'border-ink-100 bg-white'}`}>{children}</div>
    <p className="mt-1 text-[11px] text-ink-400">{label}</p>
  </div>
)

/** Company logo: preview, upload / change, remove. Only the Super Admin sees the controls; the server enforces it regardless. */
export function LogoSettings() {
  const { user } = useAuth()
  const { toast } = useToast()
  const brand = useBranding()
  const canChange = user?.accessLevel === 'Super Admin'
  const input = useRef(null)
  const [picked, setPicked] = useState(null) // { file, url } - chosen, previewed, not yet saved
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => () => { if (picked?.url) URL.revokeObjectURL(picked.url) }, [picked])

  const choose = (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // the same file can be chosen again after a refusal
    if (!file) return
    const problem = logoProblem(file)
    if (problem) { setError(problem); setPicked(null); return }
    setError('')
    setPicked({ file, url: URL.createObjectURL(file) })
  }
  const save = () => {
    if (!picked || busy) return
    const body = new FormData()
    body.append('file', picked.file)
    setBusy(true); setError('')
    api.put('/branding/logo', body, { silent: true })
      .then((res) => { applyBranding(res.data); setPicked(null); toast('Company logo updated.', { type: 'success' }) })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }
  const remove = () => {
    setBusy(true)
    api.delete('/branding/logo', { silent: true })
      .then((res) => { applyBranding(res.data); setConfirmRemove(false); toast('Custom logo removed. The default logo is shown again.', { type: 'success' }) })
      .catch((e) => { setConfirmRemove(false); toast(errorMessage(e), { type: 'error' }) })
      .finally(() => setBusy(false))
  }

  const previewImg = (cls) => (picked ? <img src={picked.url} alt="New logo preview" className={cls} /> : <BrandImg className={cls} />)
  return (
    <div className="mb-6 rounded-xl border border-ink-100 px-4 py-4 dark:border-ink-800">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">Company Logo</p>
          <p className="mt-0.5 text-xs text-ink-400">Shown in the sidebar, on the sign-in screens, the quotation preview and PDFs, and as the browser tab icon. PNG, JPG or SVG, up to 1 MB.</p>
          <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
            {picked ? <>New logo selected: <b>{picked.file.name}</b> ({picked.file.size < 1024 ? `${picked.file.size} B` : `${Math.round(picked.file.size / 1024)} KB`}) — not saved yet.</> : brand.custom ? <>Custom logo{brand.name ? <>: <b>{brand.name}</b></> : null}.</> : 'Using the default logo.'}
          </p>
          {error && <p role="alert" className="mt-2 text-xs text-rose-500">{error}</p>}
          {!canChange && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Only the Super Admin can change the company logo.</p>}
          {canChange && (
            <div className="mt-3 flex flex-wrap gap-2">
              <input ref={input} type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" className="hidden" aria-label="Choose logo file" onChange={choose} />
              {picked ? (
                <>
                  <Button size="sm" icon={Check} loading={busy} onClick={save}>Save logo</Button>
                  <Button size="sm" variant="ghost" icon={X} disabled={busy} onClick={() => { setPicked(null); setError('') }}>Cancel</Button>
                  <Button size="sm" variant="secondary" icon={ImagePlus} disabled={busy} onClick={() => input.current?.click()}>Choose another</Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" icon={ImagePlus} onClick={() => input.current?.click()}>{brand.custom ? 'Change logo' : 'Upload logo'}</Button>
                  {brand.custom && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmRemove(true)}>Remove logo</Button>}
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-3" aria-label="Logo preview">
          <Tile label="On light">{previewImg('max-h-full max-w-full object-contain')}</Tile>
          <Tile dark label="On dark">
            <span className="flex h-full w-full items-center justify-center rounded-lg bg-white p-1.5">{previewImg('max-h-full max-w-full object-contain')}</span>
          </Tile>
        </div>
      </div>
      <ConfirmDialog open={confirmRemove} onClose={() => setConfirmRemove(false)} onConfirm={remove} title="Remove the custom logo?" description="The default logo will be shown everywhere again. You can upload a new one at any time." confirmLabel="Remove logo" tone="danger" />
    </div>
  )
}
