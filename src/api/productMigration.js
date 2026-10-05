// One-time, idempotent upgrade of the Products & Services master data and everything that points at it (stamped `productV4`):
//   • every product gets an item code, unit of sale, tax rate, default discount and a price history;
//   • the seeded demo catalog gets sensible categories, types, units and billing cycles (it was generated at random);
//   • deals, leads, enquiries and projects that only carried a service *name* are tied to the catalog item by ID;
//   • quotation / proposal / sales-order / invoice lines that were typed in free-hand are matched to the catalog by exact
//     name, and every linked line gets its code, category, unit and billing cycle written onto it as a snapshot.
// Prices, descriptions and tax rates already stored on a line are never overwritten — historical documents stay as issued.
import { generateProductCode } from '../utils/productRules'
import { DEFAULT_TAX_RATE } from '../utils/salesOrderCalc'

const UNIT_BY_CYCLE = { Monthly: 'Month', Quarterly: 'Month', Annual: 'Year' }

// The demo catalog's categories were random ("UI/UX Design" under Marketing, "Digital Marketing" under Development…). Seeded items
// (PRD-001…PRD-020) are repaired once; anything a user created or edited is left alone.
const CURATED = {
  'Website Development': ['Development', 'Package', 'Project', 'One-time'], 'Mobile App Development': ['Development', 'Package', 'Project', 'One-time'], 'Custom Software Development': ['Development', 'Service', 'Day', 'One-time'],
  'E-commerce Platform': ['Development', 'Package', 'Project', 'One-time'], 'API Integration': ['Development', 'Service', 'Day', 'One-time'], 'ERP Implementation': ['Consulting', 'Package', 'Project', 'One-time'],
  'CRM Implementation': ['Consulting', 'Package', 'Project', 'One-time'], 'Business Consulting': ['Consulting', 'Service', 'Day', 'One-time'], 'Data Analytics': ['Consulting', 'Service', 'Month', 'Monthly'],
  'Payroll Software': ['Development', 'Product', 'User / Month', 'Monthly'], 'UI/UX Design': ['Design', 'Service', 'Project', 'One-time'], 'Brand Identity Design': ['Design', 'Package', 'Project', 'One-time'],
  'Digital Marketing': ['Marketing', 'Service', 'Month', 'Monthly'], 'SEO Optimization': ['Marketing', 'Service', 'Month', 'Monthly'], 'Social Media Management': ['Marketing', 'Service', 'Month', 'Monthly'],
  'Content Marketing': ['Marketing', 'Service', 'Month', 'Monthly'], 'Cloud Migration': ['Infrastructure', 'Package', 'Project', 'One-time'], 'DevOps & Automation': ['Infrastructure', 'Service', 'Day', 'One-time'],
  'IT Infrastructure Support': ['Support & Maintenance', 'Service', 'Month', 'Monthly'], 'Cybersecurity Audit': ['Infrastructure', 'Service', 'Project', 'One-time'],
}
const RETIRED_DEMO = ['SEO Optimization', 'Payroll Software']

export function migrateProducts(db) {
  db.__migrations = db.__migrations || {}
  if (db.__migrations.productV4) return db
  const now = new Date().toISOString()
  const restamp = new Map() // product id -> snapshot fields to rewrite on its (seed) document lines
  const products = []
  ;(db.products || []).forEach((raw) => {
    const cur = !raw.curated && /^PRD-0\d\d$/.test(raw.id) ? CURATED[raw.name] : null
    const base = cur
      ? { ...raw, category: cur[0], type: cur[1], unit: cur[2], billingCycle: cur[3], status: RETIRED_DEMO.includes(raw.name) ? 'Inactive' : 'Active', curated: true, code: null }
      : raw
    // seeded descriptions embedded the lower-cased name ("Professional api integration …")
    const desc = base.description && base.description.startsWith(`Professional ${String(base.name).toLowerCase()} `) ? base.description.replace(`Professional ${String(base.name).toLowerCase()} `, `Professional ${base.name} `) : base.description
    const p = {
      ...base,
      description: desc,
      code: base.code || generateProductCode(base.category, products),
      unit: base.unit || (base.type === 'Add-on' ? 'Nos' : UNIT_BY_CYCLE[base.billingCycle] || 'Project'),
      taxRate: base.taxRate ?? DEFAULT_TAX_RATE,
      defaultDiscount: base.defaultDiscount ?? 0,
      priceHistory: base.priceHistory || [{ price: base.price, at: base.createdAt || now, by: null, note: 'Opening price' }],
      createdAt: base.createdAt || now,
      updatedAt: base.updatedAt || base.createdAt || now,
    }
    if (cur) restamp.set(p.id, { productCode: p.code, category: p.category, unit: p.unit, billingCycle: p.billingCycle })
    products.push(p)
  })
  db.products = products

  const byName = new Map()
  const dup = new Set()
  products.forEach((p) => { const k = String(p.name).trim().toLowerCase(); if (byName.has(k)) dup.add(k); else byName.set(k, p) })
  const find = (name) => { const k = String(name || '').trim().toLowerCase(); return k && !dup.has(k) ? byName.get(k) || null : null }
  const byId = new Map(products.map((p) => [p.id, p]))

  const tie = (rec, field) => {
    if (rec.productId) return rec
    const p = find(rec[field])
    return p ? { ...rec, productId: p.id } : rec
  }
  db.deals = (db.deals || []).map((d) => tie(d, 'service'))
  db.leads = (db.leads || []).map((l) => tie(l, 'service'))
  db.enquiries = (db.enquiries || []).map((e) => (e.productId ? e : tie(e, e.interestedService ? 'interestedService' : 'interestedProduct')))
  db.projects = (db.projects || []).map((pr) => {
    if (pr.productId) return pr
    const p = find(String(pr.name || '').split(' — ')[0])
    return p ? { ...pr, productId: p.id } : pr
  })

  const fixLine = (it, fallbackRate) => {
    let line = it
    if (!line.productId) { const p = find(line.name); if (p) line = { ...line, productId: p.id } }
    const p = line.productId ? byId.get(line.productId) : null
    if (!p) return line.taxRate === undefined && fallbackRate !== undefined ? { ...line, taxRate: fallbackRate } : line
    const fix = restamp.get(p.id) || {}
    return {
      ...line,
      productCode: fix.productCode || line.productCode || p.code, category: fix.category || line.category || p.category, unit: fix.unit || line.unit || p.unit, billingCycle: fix.billingCycle || line.billingCycle || p.billingCycle,
      description: line.description || p.description || '',
      ...(line.taxRate === undefined && fallbackRate !== undefined ? { taxRate: fallbackRate } : {}),
    }
  }
  db.quotations = (db.quotations || []).map((q) => {
    const rate = q.subtotal > 0 ? Math.round((q.tax / q.subtotal) * 100) : DEFAULT_TAX_RATE
    return { ...q, items: (q.items || []).map((it) => fixLine(it, rate)) }
  })
  db.salesOrders = (db.salesOrders || []).map((s) => ({ ...s, items: (s.items || []).map((it) => fixLine(it)) }))
  db.invoices = (db.invoices || []).map((i) => (i.items ? { ...i, items: i.items.map((it) => fixLine(it)) } : i))
  db.proposals = (db.proposals || []).map((p) => (p.content?.items ? { ...p, content: { ...p.content, items: p.content.items.map((it) => fixLine(it)) } } : p))
  db.__migrations.productV4 = true
  return db
}
