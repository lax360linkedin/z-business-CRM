import { Construction } from 'lucide-react'
import { PageHeader } from './PageHeader'
import { EmptyState } from './EmptyState'

// Temporary scaffolding placeholder used only while a module is under active construction.
export function ComingSoon({ title, description }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <EmptyState icon={Construction} title="Module under construction" description="This section is being built and will be available shortly." />
    </div>
  )
}
