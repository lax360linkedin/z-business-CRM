import { useEffect } from 'react'
import { api } from '../api/mockServer'
import { createNotification } from '../utils/notify'

const NOTIFIED_KEY = 'business_crm_followup_notified_v1'

function readNotified() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || {}
  } catch {
    return {}
  }
}

/**
 * Frontend-only substitute for a real backend cron job: once per app load, scans open leads
 * AND open enquiries for a follow-up that's due today or overdue and creates a "Follow-up
 * Reminder" notification for each one not already notified today (de-duped per record+day in
 * localStorage so reloading the page doesn't spam the bell). This is the honest limit of
 * "generate reminders when a follow-up is due" without a real backend scheduler — reminders
 * only fire while someone has the app open, not at the exact due moment.
 */
export function useFollowUpReminders(enabled) {
  useEffect(() => {
    if (!enabled) return
    const today = new Date().toISOString().slice(0, 10)
    const notified = readNotified()
    let any = false

    const notifyDue = (records, { statusField, closedStatuses, relatedType, nameOf }) => {
      const due = records.filter((r) => r.nextFollowUp && !closedStatuses.includes(r[statusField]) && r.nextFollowUp <= today)
      due.forEach((r) => {
        const key = `${r.id}:${today}`
        if (notified[key]) return
        const overdue = r.nextFollowUp < today
        createNotification({
          type: 'Follow-up Reminder',
          message: `${overdue ? 'Overdue' : "Today's"} follow-up: ${nameOf(r)}.`,
          relatedType,
          relatedId: r.id,
        })
        notified[key] = true
        any = true
      })
    }

    Promise.all([
      api.get('/leads', { params: { all: true } }),
      api.get('/enquiries', { params: { all: true } }),
    ]).then(([leadsRes, enquiriesRes]) => {
      notifyDue(leadsRes.data, { statusField: 'status', closedStatuses: ['Converted', 'Lost'], relatedType: 'Lead', nameOf: (l) => `${l.name} (${l.company})` })
      notifyDue(enquiriesRes.data, { statusField: 'status', closedStatuses: ['Converted', 'Duplicate', 'Spam'], relatedType: 'Enquiry', nameOf: (e) => `${e.name} (${e.company || 'No company'})` })
      if (any) localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
