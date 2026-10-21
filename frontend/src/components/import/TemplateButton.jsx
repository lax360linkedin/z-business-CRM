import { useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { Button } from '../common/Button'
import { useToast } from '../../context/ToastContext'
import { api, errorMessage } from '../../api/http'
import { buildTemplate, downloadBytes, templateFileName } from '../../utils/importKit'

export async function downloadTemplate(module) {
  const { data: schema } = await api.get(`/imports/${module}/schema`, { noCache: true })
  downloadBytes(await buildTemplate(schema), templateFileName(schema))
  return schema
}

/** "Download Excel Template": an .xlsx built from the module's live import schema, so its columns, required fields and dropdown values are exactly what the import accepts. */
export function TemplateButton({ module, size = 'md', variant = 'secondary', label, className }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const go = () => {
    setBusy(true)
    downloadTemplate(module)
      .then((schema) => toast(`${schema.label} template downloaded. Fill it in, save it and upload it with Import.`, { type: 'success' }))
      .catch((e) => toast(errorMessage(e, 'Could not create the template.'), { type: 'error' }))
      .finally(() => setBusy(false))
  }
  return <Button type="button" variant={variant} size={size} icon={FileSpreadsheet} loading={busy} onClick={go} className={className} title="Download Excel Template: an Excel file with the right columns, required fields and dropdown lists" aria-label="Download Excel Template">{label || <><span className="hidden xl:inline">Download Excel Template</span><span className="xl:hidden">Excel Template</span></>}</Button>
}
