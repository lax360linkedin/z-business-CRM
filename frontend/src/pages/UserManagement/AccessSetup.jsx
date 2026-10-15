import { FormField, Select } from '../../components/common/FormField'
import { ROLES } from '../../data/constants'
import { defaultPermissionsForRole } from '../../data/permissions'
import { PermissionMatrix, normalizePermissions } from './PermissionMatrix'
import { useBranch } from '../../context/BranchContext'
import { useRoleTemplates } from '../../hooks/useRoleTemplates'

/** The two roles the Super Admin can hand out (a second Super Admin cannot be created). */
export const ASSIGNABLE_LEVELS = ['Admin', 'Employee']
/** Job profiles an Employee's permissions can start from - a starting point only: every box stays editable. */
export const TEMPLATES = ROLES.filter((r) => !['Super Admin', 'Admin'].includes(r))

export const initialAccess = (accessLevel = 'Employee', template = 'Employee', branch = '', profiles = null) => ({
  accessLevel,
  branch,
  template: accessLevel === 'Admin' ? 'Admin' : template,
  permissions: normalizePermissions((profiles && profiles[accessLevel === 'Admin' ? 'Admin' : template]) || defaultPermissionsForRole(accessLevel === 'Admin' ? 'Admin' : template)),
})

/** What gets stored on the login account: the login role, the job profile the finer module rules key off, and the exact permission set. */
export const accessToAccount = (v) => ({ accessLevel: v.accessLevel, branch: v.branch || null, role: v.accessLevel === 'Admin' ? 'Admin' : v.template, roles: [v.accessLevel === 'Admin' ? 'Admin' : v.template], permissions: normalizePermissions(v.permissions) })

/** Role + permission editor shared by Add User and Grant CRM access. `value` = { accessLevel, template, permissions }. */
export function AccessSetup({ value, onChange }) {
  const { activeNames } = useBranch()
  const { roles, profiles, loaded } = useRoleTemplates()
  const templates = loaded && roles.length ? roles.filter((r) => !['Super Admin', 'Admin'].includes(r)) : TEMPLATES
  const setLevel = (accessLevel) => onChange(initialAccess(accessLevel, accessLevel === 'Employee' ? (value.template === 'Admin' ? 'Employee' : value.template) : 'Admin', value.branch, profiles))
  const setTemplate = (template) => onChange(initialAccess('Employee', template, value.branch, profiles))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Branch" required hint={value.accessLevel === 'Admin' ? `Required. This admin runs ${value.branch || 'one branch'} only and cannot see or open any other branch. Each branch has two or three admins.` : 'Required. This person only sees and works with that one branch.'} className="col-span-2">
          <Select aria-label="Branch" value={value.branch || ''} onChange={(e) => onChange({ ...value, branch: e.target.value })}>
            <option value="">Select a branch</option>
            {activeNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </FormField>
        <FormField label="Role" required hint="Only Admin and Employee accounts can be created. Super Admin is the owner account.">
          <Select value={value.accessLevel} onChange={(e) => setLevel(e.target.value)}>
            {ASSIGNABLE_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </FormField>
        {value.accessLevel === 'Employee' ? (
          <FormField label="Start permissions from" hint="Picks a starting set for the matrix below; change any box afterwards.">
            <Select value={value.template} onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((r) => <option key={r} value={r}>{r === 'Employee' ? 'Basic employee' : r}</option>)}
            </Select>
          </FormField>
        ) : (
          <FormField label="Start permissions from" hint="An Admin starts with full access to every module except User Management and Roles & Permissions.">
            <Select value="Admin" disabled><option value="Admin">Admin (full operational access)</option></Select>
          </FormField>
        )}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-ink-700 dark:text-ink-200">Module permissions</p>
        <PermissionMatrix value={value.permissions} onChange={(permissions) => onChange({ ...value, permissions })} />
      </div>
    </div>
  )
}
