import { useState } from 'react'
import { ListPlus } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { LogActivityDialog } from './LogActivityDialog'

/** "Log Activity" for a record's own page — opens the shared dialog pre-attached (and locked) to that record. */
export function LogActivityButton({ type, id, label, onLogged, size = 'md', variant = 'secondary' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant={variant} size={size} icon={ListPlus} onClick={() => setOpen(true)}>Log Activity</Button>
      <LogActivityDialog open={open} onClose={() => setOpen(false)} related={{ type, id, label }} onLogged={() => onLogged?.()} />
    </>
  )
}
