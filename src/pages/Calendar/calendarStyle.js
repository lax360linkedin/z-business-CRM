import { CalendarClock, Briefcase, Phone, Bell, Flag } from 'lucide-react'

// One look per kind, used by the chips, the legend and the detail dialog.
export const KIND_STYLE = {
  task: { singular: 'Task', label: 'Tasks', icon: CalendarClock, chip: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200', dot: 'bg-brand-500', solid: 'bg-brand-500 text-white' },
  meeting: { singular: 'Meeting', label: 'Meetings & visits', icon: Briefcase, chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200', dot: 'bg-emerald-500', solid: 'bg-emerald-500 text-white' },
  followup: { singular: 'Follow-up', label: 'Follow-ups', icon: Phone, chip: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200', dot: 'bg-rose-500', solid: 'bg-rose-500 text-white' },
  reminder: { singular: 'Reminder', label: 'Reminders', icon: Bell, chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', dot: 'bg-amber-500', solid: 'bg-amber-500 text-white' },
  deadline: { singular: 'Deadline', label: 'Deadlines & due dates', icon: Flag, chip: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200', dot: 'bg-violet-500', solid: 'bg-violet-500 text-white' },
}
