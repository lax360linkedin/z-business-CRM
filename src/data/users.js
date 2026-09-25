import { resetSeed, pick, randInt, phoneNumber, initials, avatarColor, daysFromNow } from '../utils/generators'
import { DEPARTMENTS } from './constants'

const NAMED_STAFF = [
  { name: 'Arjun Mehta', role: 'Super Admin', department: 'Management', designation: 'Chief Executive Officer' },
  { name: 'Priya Ramanathan', role: 'Admin', department: 'Management', designation: 'Chief Operating Officer' },
  { name: 'Vivek Ratnam', role: 'MD', department: 'Management', designation: 'Managing Director' },
  { name: 'Karthik Subramaniam', role: 'Sales Manager', department: 'Sales', designation: 'Head of Sales' },
  { name: 'Sneha Kapoor', role: 'Sales Executive', department: 'Sales', designation: 'Senior Sales Executive' },
  { name: 'Rohan Iyer', role: 'Sales Executive', department: 'Sales', designation: 'Sales Executive' },
  { name: 'Divya Nair', role: 'Sales Executive', department: 'Sales', designation: 'Sales Executive' },
  { name: 'Vikram Reddy', role: 'Project Manager', department: 'Projects', designation: 'Senior Project Manager' },
  { name: 'Ananya Joshi', role: 'Project Manager', department: 'Projects', designation: 'Project Manager' },
  { name: 'Nikhil Sharma', role: 'Accounts', department: 'Finance', designation: 'Finance Manager' },
  { name: 'Meera Pillai', role: 'Accounts', department: 'Finance', designation: 'Accounts Executive' },
  { name: 'Suresh Kumar', role: 'Support', department: 'Support', designation: 'Support Team Lead' },
  { name: 'Riya Chawla', role: 'Support', department: 'Support', designation: 'Support Executive' },
  { name: 'Aditya Verma', role: 'Sales Executive', department: 'Sales', designation: 'Sales Executive' },
  { name: 'Kavya Menon', role: 'Sales Manager', department: 'Marketing', designation: 'Head of Marketing' },
  { name: 'Deepak Malhotra', role: 'Project Manager', department: 'Projects', designation: 'Delivery Manager' },
  { name: 'Lakshmi Bhat', role: 'HR', department: 'HR', designation: 'HR Manager' },
  { name: 'Sandeep Rao', role: 'HR', department: 'HR', designation: 'HR Executive' },
  { name: 'Nandini Pillai', role: 'Project Staff', department: 'Projects', designation: 'Software Engineer' },
  { name: 'Manoj Kumar', role: 'Project Staff', department: 'Projects', designation: 'QA Engineer' },
  { name: 'Meera Krishnan', role: 'Marketing', department: 'Marketing', designation: 'Marketing Executive' },
  { name: 'Ramesh Iyer', role: 'CEO', department: 'Management', designation: 'Chief Executive Officer' },
]

resetSeed(7)
export const USERS = NAMED_STAFF.map((u, i) => {
  const email = `${u.name.toLowerCase().replace(/\s+/g, '.')}@lax360.com`
  return {
    id: `EMP-${String(i + 1).padStart(3, '0')}`,
    name: u.name,
    email,
    phone: phoneNumber(),
    department: u.department,
    designation: u.designation,
    role: u.role,
    status: i === 12 ? 'Inactive' : 'Active',
    joinDate: daysFromNow(-randInt(60, 1400)),
    initials: initials(u.name),
    avatarColor: avatarColor(u.name),
  }
})

export const CURRENT_USER = USERS[0]

export function getUserById(id) {
  return USERS.find((u) => u.id === id)
}

export function randomUser(deptFilter) {
  const pool = deptFilter ? USERS.filter((u) => u.department === deptFilter) : USERS
  return pick(pool.length ? pool : USERS)
}

export function salesUsers() {
  return USERS.filter((u) => u.department === 'Sales')
}
export function projectManagers() {
  return USERS.filter((u) => u.role === 'Project Manager')
}
export function supportUsers() {
  return USERS.filter((u) => u.department === 'Support')
}

export const DEMO_ROLES = DEPARTMENTS
