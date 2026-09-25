// Deterministic pseudo-random generator so seeded mock data is stable across reloads.
let seed = 42
export function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
export function resetSeed(s = 42) {
  seed = s
}
export function pick(arr) {
  return arr[Math.floor(rand() * arr.length)]
}
export function pickMany(arr, count) {
  const copy = [...arr]
  const out = []
  for (let i = 0; i < count && copy.length; i++) {
    const idx = Math.floor(rand() * copy.length)
    out.push(copy.splice(idx, 1)[0])
  }
  return out
}
export function randInt(min, max) {
  return Math.floor(rand() * (max - min + 1)) + min
}
export function randFloat(min, max, decimals = 0) {
  const v = rand() * (max - min) + min
  return Number(v.toFixed(decimals))
}
export function daysFromNow(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
export function pad(num, size = 4) {
  return String(num).padStart(size, '0')
}
export function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Rohan',
  'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kavya', 'Myra', 'Anika', 'Ira', 'Riya', 'Priya',
  'Rahul', 'Karthik', 'Vikram', 'Nikhil', 'Suresh', 'Rajesh', 'Amit', 'Sandeep', 'Deepak', 'Manoj',
  'Sneha', 'Pooja', 'Neha', 'Divya', 'Meera', 'Kritika', 'Shreya', 'Nandini', 'Lakshmi', 'Swathi',
  'James', 'Michael', 'David', 'Daniel', 'Robert', 'William', 'Olivia', 'Emma', 'Sophia', 'Ava',
]
export const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Iyer', 'Nair', 'Menon', 'Reddy', 'Rao', 'Kumar', 'Singh',
  'Patel', 'Shah', 'Mehta', 'Joshi', 'Kapoor', 'Malhotra', 'Chawla', 'Bhat', 'Pillai', 'Naidu',
  'Anderson', 'Wilson', 'Clark', 'Lewis', 'Walker', 'Hall', 'Young', 'King', 'Wright', 'Scott',
]
export function personName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`
}

export const COMPANY_PREFIX = [
  'Nimbus', 'Vertex', 'Orbit', 'Skyline', 'Bluepeak', 'Cedar', 'Northstar', 'Quantum', 'Silverline', 'Brightpath',
  'Zenith', 'Ironclad', 'Everline', 'Solstice', 'Meridian', 'Crestview', 'Aster', 'Falcon', 'Harborline', 'Lumina',
  'Pinnacle', 'Redwood', 'Stratos', 'Trueform', 'Anchorpoint', 'Bright Origin', 'Clearpath', 'Delta Edge', 'Evergreen', 'Fusion',
]
export const COMPANY_SUFFIX = ['Technologies', 'Solutions', 'Industries', 'Enterprises', 'Systems', 'Global', 'Retail', 'Labs', 'Group', 'Ventures']
export function companyName() {
  return `${pick(COMPANY_PREFIX)} ${pick(COMPANY_SUFFIX)}`
}

export const INDUSTRIES = [
  'Information Technology', 'Manufacturing', 'Healthcare', 'Retail & E-commerce', 'Real Estate',
  'Education', 'Logistics & Supply Chain', 'Financial Services', 'Hospitality', 'Media & Entertainment',
  'Construction', 'Automotive', 'Telecommunications', 'Pharmaceuticals', 'Agriculture',
]

export const SERVICES = [
  'Website Development', 'Mobile App Development', 'Digital Marketing', 'SEO Optimization',
  'Cloud Migration', 'ERP Implementation', 'CRM Implementation', 'UI/UX Design',
  'Brand Identity Design', 'IT Infrastructure Support', 'Data Analytics', 'Cybersecurity Audit',
  'E-commerce Platform', 'Social Media Management', 'Content Marketing', 'Payroll Software',
  'Custom Software Development', 'API Integration', 'DevOps & Automation', 'Business Consulting',
]

export const LEAD_SOURCES = [
  'Website', 'Contact Form', 'Google', 'Facebook', 'Instagram', 'WhatsApp', 'LinkedIn',
  'Referral', 'Phone', 'Email', 'Walk-in', 'Campaign', 'Manual Entry', 'Import',
]

export const CITIES = [
  'Chennai', 'Bengaluru', 'Mumbai', 'Hyderabad', 'Pune', 'Delhi NCR', 'Coimbatore', 'Kochi',
  'Ahmedabad', 'Kolkata', 'New York', 'London', 'Singapore', 'Dubai', 'Toronto',
]

export function companyEmail(company, person) {
  const domain = slugify(company).slice(0, 14) + '.com'
  const local = person.toLowerCase().replace(/\s+/g, '.')
  return `${local}@${domain}`
}

export function phoneNumber() {
  return `+91 ${randInt(70000, 99999)} ${randInt(10000, 99999)}`
}

export const AVATAR_COLORS = [
  'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
]
export function initials(name) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}
export function avatarColor(name) {
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length
  return AVATAR_COLORS[idx]
}
