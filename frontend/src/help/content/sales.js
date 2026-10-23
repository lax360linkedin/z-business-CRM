export const sales = {
  deals: {
    title: 'Deals',
    purpose: 'Deals are your sales opportunities: each one has a value, an owner and a stage from first discussion to won or lost. This page is where you manage and move them forward.',
    features: [
      'Two views: a Kanban board with one column per stage, and a Table. Choose with the view buttons above the list.',
      'Summary tiles for pipeline value, weighted value (value × the stage’s chance of closing), won value and lost value.',
      'Stages and their chance of closing: Deal Created 10%, Requirement Analysis 20%, Solution Discussion 35%, Decision Maker Review 50%, Proposal / Quotation 70%, Negotiation 85%, Final Decision 95%, then Closed Won or Closed Lost.',
      'Search and filters by company, contact, stage, owner and dates.',
    ],
    actions: [
      ['Add Deal', 'Creates a deal: give it a name, company, value, expected closing date and owner.'],
      ['Kanban / Table', 'Switches between the board and the list. On the board, drag a card to another column to change its stage.'],
      ['Moving to Closed Won / Closed Lost', 'Asks you to confirm. A lost deal also needs a reason, which is kept for reporting.'],
      ['Search box and filters', 'Narrow the deals shown by name, company, contact, stage or owner.'],
      ['Open a deal', 'Click a card or row to see its full history and actions.'],
    ],
    workflows: [{ title: 'Moving a deal to a win', steps: [
      'Open the deal (or drag its card) and move it through the stages as the conversation progresses.',
      'At Proposal / Quotation, create the proposal or quotation from the deal so the figures stay linked.',
      'When the customer agrees, move the deal to Closed Won and confirm. A customer record is linked to the deal.',
      'Continue with a sales order from the accepted quotation, then the invoice.',
    ] }],
    tips: ['Weighted value is a forecast, not a promise: it shrinks when deals sit in early stages.', 'Deleting a deal is only possible if no quotation or order depends on it.'],
    related: [['Sales Pipeline', '/pipeline'], ['Quotations', '/quotations'], ['Proposals', '/proposals'], ['Leads', '/leads']],
  },

  dealDetail: {
    title: 'Deal details',
    purpose: 'One deal in full: value, stage, requirement, linked company and contact, and the history of everything done on it.',
    features: ['Deal value, expected closing date, competitor and decision maker.', 'A timeline of calls, emails, meetings, notes and every stage change.', 'Links to the company, contact, customer and the proposals and quotations created from this deal.'],
    actions: [
      ['Change Stage', 'Moves the deal forward (or back). Closing it as Won or Lost asks for confirmation; Lost also needs a reason.'],
      ['Call / Email / WhatsApp / Meeting', 'Contacts the decision maker and offers to log it on the timeline.'],
      ['Add Follow-up / Add Note', 'Schedules the next step or records what was said.'],
      ['Create Proposal / Create Quotation', 'Starts a proposal or quotation already linked to this deal.'],
      ['Edit Deal', 'Changes value, dates, owner and other details.'],
      ['More Actions → Delete Deal', 'Removes the deal if nothing else depends on it.'],
    ],
    related: [['All deals', '/deals'], ['Proposals', '/proposals'], ['Quotations', '/quotations']],
  },

  pipeline: {
    title: 'Sales Pipeline',
    purpose: 'The analysis view of your sales pipeline: how much is open, how likely it is to close, where deals get stuck and how each salesperson is doing.',
    features: [
      'Headline numbers: open pipeline, weighted forecast, win rate, average deal size, average sales cycle and deals closing this month.',
      'Charts for deals at every stage, the sales funnel, win / loss mix and the revenue forecast.',
      'At-risk deals (open deals past their expected closing date) and performance by sales rep.',
    ],
    actions: [
      ['Search box', 'Finds a deal in the pipeline views by name.'],
      ['Stage and rep charts', 'Hover for counts and values; use the lists beneath to open the deals behind a number.'],
      ['At-Risk Deals', 'Open a deal from this list to update its date or stage so the forecast stays honest.'],
    ],
    tips: ['To change a deal, open it (or use the Deals page); this page is for understanding the pipeline rather than editing it.'],
    related: [['Deals', '/deals'], ['Sales reports', '/reports/sales'], ['AI Insights', '/ai-insights']],
  },

  quotations: {
    title: 'Quotations',
    purpose: 'Create, approve and send price quotations to customers, and see which ones have been accepted so they can become sales orders.',
    features: [
      'A list of quotations with number, customer, amount, validity and status: Draft, Pending Approval, Sent, Viewed, Negotiation, Accepted, Rejected or Expired.',
      'Line items with tax, payment terms, terms & conditions and a valid-until date.',
      'Letterhead templates for the printed or PDF quotation, and the option to attach an existing quotation file instead.',
    ],
    actions: [
      ['Create Quotation', 'Opens the form: choose the company, contact and (optionally) the deal or lead, add items, then save as a draft.'],
      ['Add Item', 'Adds a line (name, quantity, price) to the quotation being created.'],
      ['Valid Until / Payment Terms / Terms & Conditions', 'Set how long the offer stands and what the customer agrees to.'],
      ['Manage Templates', 'Opens the quotation templates where the letterhead, header and footer are designed.'],
      ['Search box and filters', 'Find quotations by number, client or status.'],
    ],
    workflows: [{ title: 'From quotation to order', steps: [
      'Create the quotation and open it.',
      'If approval is required, choose Submit for Approval; a Sales Manager, Admin or MD approves or rejects it.',
      'Choose Send (Send to Client) to record that it has gone to the customer; the status becomes Sent, then Viewed or Negotiation as the customer responds.',
      'Record the customer’s decision: Accepted or Rejected.',
      'On an accepted quotation choose Create Sales Order to carry everything across.',
    ] }],
    related: [['Sales Orders', '/sales-orders'], ['Quotation templates', '/quotation-templates'], ['Deals', '/deals']],
  },

  quotationDetail: {
    title: 'Quotation details',
    purpose: 'A single quotation as the customer will see it, with the actions that move it through approval, sending and acceptance.',
    features: ['The full quotation: items, tax, totals, terms and validity.', 'A status that follows the quotation from Draft to Accepted, Rejected or Expired.', 'Preview, print and PDF download.'],
    actions: [
      ['Submit for Approval', 'Sends a draft to a manager for approval.'],
      ['Approve / Reject', 'Shown to approvers (Sales Manager, Admin, MD, Super Admin) while the quotation awaits approval.'],
      ['Send / Send to Client', 'Sends the quotation to the customer and sets it to Sent. A quotation file attached from outside the CRM is sent the same way.'],
      ['Preview / Print / Download PDF', 'Shows the quotation on its letterhead, prints it or saves it as a PDF.'],
      ['Status buttons (Viewed, Negotiation, Accepted, Rejected)', 'Record how the customer responded.'],
      ['Create Sales Order / View Sales Order', 'Once accepted, creates the order from this quotation, or opens the order already created.'],
    ],
    related: [['All quotations', '/quotations'], ['Sales Orders', '/sales-orders']],
  },

  quotationTemplates: {
    title: 'Quotation templates',
    purpose: 'The letterhead designs your quotations use. A template controls the logo, header, footer and watermark that surround the quotation’s content; until you add one, quotations use the built-in layout.',
    features: ['A list of templates; one is the default for new quotations.', 'Upload your official letterhead as a PDF, image (PNG, JPG) or Word (.docx) file, or design a template in the Word-like editor.', 'Only the Super Admin, Admin, MD or Sales Manager can upload or edit templates.'],
    actions: [
      ['Upload Template', 'Uploads your official letterhead file as a new template.'],
      ['New Template', 'Starts a template from scratch in the editor.'],
      ['Preview', 'Shows the template filled with sample data, the same way real quotations are produced.'],
      ['Validate', 'Checks that the placeholders in a template can be filled in.'],
      ['Set Default', 'Uses this template for new quotations.'],
      ['Edit / Replace / Delete', 'Changes the template’s content, swaps its file, or removes it.'],
    ],
    related: [['Quotations', '/quotations'], ['Company logo', '/settings/company-profile']],
  },

  quotationTemplateEditor: {
    title: 'Template editor',
    purpose: 'A page designer for the quotation letterhead: type directly on the page like a Word document and insert CRM fields that fill in automatically.',
    features: ['A ribbon of formatting tools and an A4 page preview with header, body and footer areas.', 'Insertable fields such as customer name, quotation number and totals.', 'Optional company logo and watermark.'],
    actions: [
      ['Header and footer', 'Switch each on, type its text and (optionally) add the company logo, sized and aligned as you like.'],
      ['Insert field', 'Places a CRM field at the cursor; it is replaced with the real value on each quotation.'],
      ['Save', 'Stores the template; new quotations can then use it.'],
    ],
    related: [['Quotation templates', '/quotation-templates']],
  },

  salesOrders: {
    title: 'Sales Orders',
    purpose: 'A sales order is a confirmed customer order. Orders are created from accepted quotations and are where delivery is tracked and invoices are raised.',
    features: [
      'Order list with customer, amount, status and billing status.',
      'Statuses: Draft, Confirmed, Processing, Partially Fulfilled, Fulfilled and Cancelled.',
      'Summary tiles for total orders, open order value, orders awaiting an invoice and fulfilled orders.',
    ],
    actions: [
      ['New Sales Order', 'Lists accepted quotations that do not yet have an order; pick one and its details are carried over for you to review.'],
      ['Search box', 'Find orders by number, customer, quotation or deal.'],
      ['Export', 'Downloads the orders currently listed.'],
    ],
    workflows: [{ title: 'From accepted quotation to invoice', steps: [
      'Choose New Sales Order and pick the accepted quotation.',
      'Review the order and save it as a draft, then confirm it.',
      'As work is delivered, change the status and use Record Fulfilment for partial deliveries.',
      'Choose Create Invoice on the order to bill the customer.',
    ] }],
    related: [['Quotations', '/quotations'], ['Invoices', '/invoices']],
  },

  salesOrderForm: {
    title: 'Sales order form',
    purpose: 'Review and finish a sales order before it is confirmed: items, prices, tax, delivery and payment terms.',
    features: ['Details copied from the accepted quotation.', 'Editable lines, delivery date and terms while the order is a draft.'],
    actions: [
      ['Add line', 'Adds another item to the order.'],
      ['Save as Draft', 'Keeps the order unconfirmed so you can return to it.'],
      ['Save Changes / Save Revision', 'On an existing order, saves your edits; changes to a confirmed order are saved as a revision so the history is kept.'],
      ['Cancel / Back', 'Leaves without saving.'],
    ],
    related: [['Sales Orders', '/sales-orders']],
  },

  salesOrderDetail: {
    title: 'Sales order details',
    purpose: 'One order in full: what was sold, its delivery status and billing, with the actions to progress it.',
    features: ['Items, totals, customer and delivery details.', 'Fulfilment progress and the invoices raised against the order.', 'A timeline of follow-ups and notes.'],
    actions: [
      ['Change Status', 'Moves the order forward: Draft → Confirmed → Processing → Fulfilled (or Cancelled).'],
      ['Record Fulfilment', 'Records quantities delivered; the order becomes Partially Fulfilled until everything is delivered.'],
      ['Create Invoice / View Invoice', 'Bills the customer from this order, or opens the invoice already created.'],
      ['Record payment', 'Takes you to record a payment against the order’s invoice.'],
      ['Attach Document', 'Adds a file to the order.'],
      ['Download PDF / Print', 'Produces the order document.'],
      ['Delete draft', 'Removes an order that was never confirmed.'],
    ],
    related: [['All sales orders', '/sales-orders'], ['Invoices', '/invoices']],
  },

  proposals: {
    title: 'Proposals',
    purpose: 'Proposals are the detailed documents you present to a prospect for a deal, before prices are formally quoted. Use this page to write, review, send and track them.',
    features: [
      'Statuses: Draft, Internal Review, Sent, Viewed, Revision Requested, Accepted, Rejected and Expired.',
      'Tiles for total, open, accepted and expired proposals with their values.',
      'Filters by status, owner, company, deal, value range and expiry.',
    ],
    actions: [
      ['New Proposal', 'Starts a proposal for one of your open deals.'],
      ['Manage Templates', 'Opens the proposal templates used to lay the document out.'],
      ['Search box and filters', 'Find proposals by number, title, client or deal; narrow by status, value and expiry.'],
      ['Export', 'Downloads the proposals currently listed.'],
    ],
    workflows: [{ title: 'Writing and sending a proposal', steps: [
      'Choose New Proposal and pick the deal.',
      'Fill in the scope, modules, phases and pricing, and save the draft.',
      'Choose Submit for Review so a colleague can check it.',
      'After review, choose Send Proposal. Record whether the client viewed, asked for changes (Create Revision), accepted or rejected it.',
      'When it is accepted, use Create Quotation to turn the agreed scope into a quotation.',
    ] }],
    related: [['Deals', '/deals'], ['Quotations', '/quotations'], ['Proposal templates', '/proposal-templates']],
  },

  proposalForm: {
    title: 'Proposal form',
    purpose: 'Write or edit a proposal: choose the deal, describe the scope and set the commercial terms.',
    features: ['Details carried over from the deal.', 'Sections for modules, phases and priced lines.'],
    actions: [
      ['Add line / Add module / Add phase', 'Adds priced lines, solution modules or delivery phases.'],
      ['Open proposal', 'After saving, opens the proposal page.'],
      ['Cancel / Back', 'Leaves without saving.'],
    ],
    related: [['Proposals', '/proposals']],
  },

  proposalDetail: {
    title: 'Proposal details',
    purpose: 'A proposal with its full content, status and version history, and the actions to review, send and follow it up.',
    features: ['The proposal document, preview and PDF.', 'Versions: each revision is kept and can be compared with the master.', 'Timeline of follow-ups, notes and attachments.'],
    actions: [
      ['Submit for Review / Review', 'Sends the draft for internal review, then records the reviewer’s decision.'],
      ['Send Proposal', 'Sends it to the client and sets its status to Sent.'],
      ['Change Status', 'Records how the client responded: Viewed, Revision Requested, Accepted or Rejected.'],
      ['Create Revision / Compare with master', 'Creates a new version after changes are requested, and shows what differs.'],
      ['Preview / Generate PDF, Download, Print', 'Produces the document.'],
      ['Create Quotation', 'Starts a quotation from the accepted proposal.'],
      ['Edit Proposal / Delete draft', 'Edits it, or removes a draft that was never sent.'],
    ],
    related: [['All proposals', '/proposals'], ['Quotations', '/quotations'], ['Deals', '/deals']],
  },

  proposalTemplates: {
    title: 'Proposal templates',
    purpose: 'Reusable layouts and wording for proposals, so every proposal looks consistent.',
    features: ['Branded layouts for the proposal PDF: header, footer, watermark and logo. Until you add one, proposals use the built-in layout.', 'A list of templates with a default.'],
    actions: [
      ['New Template / Upload Template', 'Creates a template in the editor, or uploads a letterhead file.'],
      ['Preview', 'Shows the template with sample data.'],
      ['Set Default', 'Uses it for new proposals.'],
      ['Edit / Delete', 'Changes or removes a template.'],
    ],
    related: [['Proposals', '/proposals']],
  },

  proposalTemplateEditor: {
    title: 'Proposal template editor',
    purpose: 'A page designer for proposal layouts: type on the page and insert fields that fill in from the deal.',
    features: ['Word-like editing on an A4 page.', 'Header, footer, logo and watermark.', 'Insertable CRM fields.'],
    actions: [
      ['Insert field', 'Places a field at the cursor, replaced by real values in each proposal.'],
      ['Save', 'Stores the template for use in new proposals.'],
    ],
    related: [['Proposal templates', '/proposal-templates']],
  },
}
