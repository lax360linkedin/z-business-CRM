export const finance = {
  invoices: {
    title: 'Invoices',
    purpose: 'Billing and collections: invoices are raised from confirmed sales orders and tracked until every payment has been received.',
    features: [
      'Statuses: Draft, Sent, Viewed, Partially Paid, Paid, Overdue, Cancelled and Void. Paid, Partially Paid and Overdue follow the payments actually recorded and the due date.',
      'Metric tiles for invoiced, collected, outstanding and overdue amounts, plus a chart of invoiced and collected money per month.',
      'Search by number, customer, company, order, deal or project; filters by status, dates and amount.',
    ],
    actions: [
      ['New invoice', 'Creates an invoice, normally from a sales order so the customer and items carry over.'],
      ['Search box and filters', 'Find invoices quickly; Clear resets the filters.'],
      ['Export', 'Downloads the invoices currently listed.'],
      ['Open an invoice', 'Shows the invoice with the actions to send it, record payments and follow up.'],
    ],
    workflows: [{ title: 'Billing a customer', steps: [
      'Create the invoice (from the sales order) and check the items, tax and due date. It starts as a Draft.',
      'Choose Send. The invoice becomes Sent and starts counting towards money owed.',
      'When money arrives, open the invoice and choose Record payment. The status moves to Partially Paid or Paid.',
      'If the due date passes with a balance, the invoice becomes Overdue automatically; use Follow up or Payment follow-up to chase it.',
    ] }],
    tips: ['Drafts, cancelled and void invoices never count as money owed.', 'A paid invoice is locked apart from notes; correct a mistake with a cancellation or refund.'],
    related: [['Payments', '/payments'], ['Sales Orders', '/sales-orders'], ['Finance reports', '/reports/finance'], ['Invoice settings', '/settings/modules/invoices']],
  },

  invoiceDetail: {
    title: 'Invoice details',
    purpose: 'One invoice with its items, tax, payments received and balance, and the actions to send it, collect payment and follow up.',
    features: ['Items, tax, totals, due date and the outstanding balance.', 'Every payment recorded against the invoice.', 'Documents, follow-ups and a timeline of what has happened.'],
    actions: [
      ['Edit', 'Changes a draft freely; an issued invoice allows only limited changes.'],
      ['Send / Mark viewed', 'Issues the invoice to the customer, and records that they opened it.'],
      ['Record payment', 'Adds a payment (amount, date, method, reference). Part payments are allowed.'],
      ['Follow up / Payment follow-up', 'Schedules a call, email, meeting or task to collect the money (also creates a task where relevant).'],
      ['Preview / Print / Download PDF', 'Shows or produces the invoice document.'],
      ['Duplicate', 'Copies the invoice into a new draft.'],
      ['Refresh from customer record', 'Re-reads the customer’s current billing details into a draft.'],
      ['Void / Cancel', 'Takes the invoice out of use; it can no longer be paid.'],
      ['Upload document', 'Attaches a supporting file.'],
    ],
    related: [['All invoices', '/invoices'], ['Payments', '/payments']],
  },

  payments: {
    title: 'Payments',
    purpose: 'The record of money received against your invoices. Payments are recorded from an invoice, locked once completed, and corrected only by cancellation or refund.',
    features: ['Tiles for total received, today, this month and more.', 'Search by payment number, invoice, customer, company or reference; filters by date, amount, method and status.', 'A receipt for each payment.'],
    actions: [
      ['Search box and filters', 'Find payments; Clear resets them.'],
      ['Export', 'Downloads the payments currently listed.'],
      ['Open a payment', 'Shows its details, receipt and the actions below.'],
      ['Recording a new payment', 'Done from the invoice (Record payment), so every payment is tied to an invoice.'],
    ],
    related: [['Invoices', '/invoices'], ['Finance reports', '/reports/finance']],
  },

  paymentDetail: {
    title: 'Payment details',
    purpose: 'One payment with the invoice and customer it belongs to, its proof and receipt, and any refund.',
    features: ['Amount, date, method and reference.', 'The linked invoice, customer and company.', 'Proof of payment, receipt and a history of changes.'],
    actions: [
      ['Mark completed / Mark failed', 'Confirms a pending payment arrived, or records that it did not.'],
      ['Record refund', 'Returns all or part of a completed payment; the refund is recorded against it.'],
      ['Cancel payment', 'Reverses a payment entered in error.'],
      ['Upload proof', 'Attaches a bank slip or screenshot.'],
      ['Receipt / Print receipt / Download PDF', 'Shows or produces the receipt.'],
      ['Add follow-up / Add note / Create task', 'Records what still needs doing.'],
      ['Edit / Save changes', 'Changes the notes and reference while the payment allows it.'],
    ],
    related: [['All payments', '/payments'], ['Invoices', '/invoices']],
  },

  expenses: {
    title: 'Expenses',
    purpose: 'Money the business spends: vendor bills, employee claims and company costs. Expenses are kept apart from customer invoices and payments, and only meet them in reports.',
    features: [
      'Three kinds with their own routes: Company expense (Draft → Approved → Paid), Vendor expense (Draft → Submitted → Approved → Paid) and Employee reimbursement (Draft → Submitted → Approved → Reimbursed).',
      'Statuses include Under Review, Rejected and Cancelled; only Approved, Paid and Reimbursed expenses count as real costs.',
      'A chart of expenses by month, filters by status, kind, date and amount, and managed lists of vendors and categories.',
    ],
    actions: [
      ['New expense', 'Records an expense: kind, date, amount, tax, category, vendor or employee, and a receipt.'],
      ['Search box and filters', 'Find expenses by number, description, vendor, employee or project.'],
      ['Export', 'Downloads the expenses currently listed.'],
      ['Open an expense', 'Shows its approval trail and the actions for your role (Submit, Approve, Reject, Pay).'],
    ],
    workflows: [{ title: 'Claiming an employee expense', steps: [
      'Choose New expense, pick Employee reimbursement and fill in the amount, category and receipt.',
      'Save it as a Draft, then choose Submit.',
      'A manager reviews it and chooses Approve (or Reject with a reason).',
      'Finance pays it and marks it Reimbursed.',
    ] }],
    related: [['Finance reports', '/reports/finance'], ['Expense settings', '/settings/modules/expenses']],
  },

  expenseDetail: {
    title: 'Expense details',
    purpose: 'One expense with its amount, tax, receipt and approval history, and the buttons that move it through approval and payment.',
    features: ['Overview and an Approval tab showing who reviewed it and when.', 'Receipts and other documents.', 'Follow-ups and notes.'],
    actions: [
      ['Submit / Withdraw', 'Sends a draft for approval, or pulls a submitted one back for changes.'],
      ['Start review / Approve / Reject', 'Approvers examine the expense and decide.'],
      ['Reopen to revise', 'Returns a rejected expense to draft so it can be corrected.'],
      ['Upload document', 'Adds a receipt or supporting file.'],
      ['Add follow-up / Add note / Create task', 'Records what still needs doing, such as document collection or approval chasing.'],
      ['Edit / Cancel', 'Changes a draft, or cancels the expense.'],
    ],
    related: [['All expenses', '/expenses']],
  },
}
