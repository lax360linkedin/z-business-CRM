import { ExportMenu } from './ExportMenu'
import { captureReport } from '../../utils/reportCapture'

/**
 * Export for a page made of key figures, charts and tables (reports, dashboard, pipeline): the file is built from the page as it is on screen - its StatCards, ChartCards (the picture
 * in the PDF, the figures behind it in every format) and tables - so it always matches what this person, in this branch, can see. `rootRef` is the element that holds the page.
 */
export function PageExport({ rootRef, title, subtitle, name, permission, disabled }) {
  return (
    <ExportMenu
      title={title}
      name={name}
      permission={permission}
      disabled={disabled}
      getDocument={(format, ctx) => captureReport(rootRef.current, { title, subtitle, user: ctx.user, branch: ctx.branch, withCharts: format === 'pdf' })}
    />
  )
}
