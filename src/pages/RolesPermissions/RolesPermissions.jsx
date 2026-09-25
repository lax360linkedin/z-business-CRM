import { Fragment, useEffect, useState } from 'react'
import { RotateCcw, Save, ShieldCheck, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Tabs } from '../../components/common/Tabs'
import { Button } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { getEffectiveRoles, getCustomRoles, addCustomRole, removeCustomRole, ROLES as BUILT_IN_ROLES } from '../../data/constants'
import { NAV_SECTIONS } from '../../routes/navConfig'
import {
  ACTIONS, defaultPermissionsForRole, buildDefaultPermissions, loadPermissions, savePermissions,
} from '../../data/permissions'
import { getDataScope } from '../../data/dataScope'
import { logAuditEvent } from '../../utils/auditLog'

export default function RolesPermissions() {
  const [roles, setRoles] = useState(() => getEffectiveRoles())
  const [permissions, setPermissions] = useState(() => loadPermissions() || buildDefaultPermissions())
  const [activeRole, setActiveRole] = useState(roles[0])
  const [createRoleOpen, setCreateRoleOpen] = useState(false)
  const [deleteRoleTarget, setDeleteRoleTarget] = useState(null)
  const { toast } = useToast()
  const { user, hasPermission } = useAuth()
  const canEdit = hasPermission('Roles & Permissions', 'edit')
  const isCustomRole = !BUILT_IN_ROLES.includes(activeRole)

  useEffect(() => {
    savePermissions(permissions)
  }, [permissions])

  const toggle = (label, actionKey) => {
    if (!canEdit) return
    setPermissions((prev) => ({
      ...prev,
      [activeRole]: {
        ...prev[activeRole],
        [label]: {
          ...prev[activeRole]?.[label],
          [actionKey]: !prev[activeRole]?.[label]?.[actionKey],
        },
      },
    }))
  }

  const resetRole = () => {
    setPermissions((prev) => ({ ...prev, [activeRole]: defaultPermissionsForRole(activeRole) }))
    toast(`Permissions for "${activeRole}" reset to defaults.`, { type: 'info' })
    logAuditEvent({ user, action: 'Reset Role Permissions', module: 'Roles & Permissions', record: activeRole })
  }

  const saveChanges = () => {
    savePermissions(permissions)
    toast(`Permissions saved for "${activeRole}".`, { type: 'success' })
    logAuditEvent({ user, action: 'Update Role Permissions', module: 'Roles & Permissions', record: activeRole })
  }

  const createRole = (data) => {
    const updated = addCustomRole(data.name)
    const nextRoles = getEffectiveRoles()
    setRoles(nextRoles)
    setPermissions((prev) => ({ ...prev, [data.name]: defaultPermissionsForRole(data.name) }))
    setActiveRole(data.name)
    setCreateRoleOpen(false)
    toast(`Custom role "${data.name}" created. It's now available on Login and Add User.`, { type: 'success' })
    logAuditEvent({ user, action: 'Create Custom Role', module: 'Roles & Permissions', record: data.name })
    return updated
  }

  const confirmDeleteRole = () => {
    removeCustomRole(deleteRoleTarget)
    const nextRoles = getEffectiveRoles()
    setRoles(nextRoles)
    setPermissions((prev) => {
      const next = { ...prev }
      delete next[deleteRoleTarget]
      return next
    })
    logAuditEvent({ user, action: 'Delete Custom Role', module: 'Roles & Permissions', record: deleteRoleTarget })
    toast(`Custom role "${deleteRoleTarget}" removed.`, { type: 'success' })
    if (activeRole === deleteRoleTarget) setActiveRole(nextRoles[0])
    setDeleteRoleTarget(null)
  }

  const rolePerms = permissions[activeRole] || {}

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        description="Define exactly what each role can view, create, edit, delete, and export across every module."
        actions={
          <>
            {canEdit && <Button variant="secondary" icon={Plus} onClick={() => setCreateRoleOpen(true)}>Create Role</Button>}
            <Button variant="secondary" icon={RotateCcw} onClick={resetRole} disabled={!canEdit}>Reset to Defaults</Button>
            <Button icon={Save} onClick={saveChanges} disabled={!canEdit}>Save Changes</Button>
          </>
        }
      />

      <div className="mb-5 flex items-center gap-2 rounded-2xl border border-ink-100 bg-white p-1.5 shadow-card dark:border-ink-800 dark:bg-ink-900">
        <div className="flex-1 overflow-hidden">
          <Tabs tabs={roles} active={activeRole} onChange={setActiveRole} />
        </div>
        {isCustomRole && canEdit && (
          <Button variant="ghost" size="sm" icon={Trash2} className="mr-1.5 shrink-0 text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20" onClick={() => setDeleteRoleTarget(activeRole)}>
            Delete Role
          </Button>
        )}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700 dark:bg-brand-900/20 dark:text-brand-300">
        <ShieldCheck size={16} className="shrink-0" />
        <span>
          Editing access for <span className="font-semibold">{activeRole}</span>
          {isCustomRole && ' (custom role)'}. Changes are saved to this browser automatically.
          {!canEdit && ' You have view-only access to this page.'}
        </span>
      </div>

      <div className="scrollbar-thin overflow-x-auto rounded-2xl border border-ink-100 bg-white shadow-card dark:border-ink-800 dark:bg-ink-900">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/60 dark:border-ink-800 dark:bg-ink-800/40">
              <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Module</th>
              {ACTIONS.map((a) => (
                <th key={a.key} className="w-24 whitespace-nowrap px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  {a.label}
                </th>
              ))}
              <th className="w-32 whitespace-nowrap px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">Data Scope</th>
            </tr>
          </thead>
          <tbody>
            {NAV_SECTIONS.map((section) => (
              <Fragment key={section.title || section.items[0]?.label || 'general'}>
                {section.title && (
                  <tr key={`${section.title}-header`} className="border-b border-ink-50 bg-ink-50/40 dark:border-ink-800/60 dark:bg-ink-800/20">
                    <td colSpan={ACTIONS.length + 2} className="px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">
                      {section.title}
                    </td>
                  </tr>
                )}
                {section.items.map((item) => (
                  <tr key={item.label} className="border-b border-ink-50 last:border-0 dark:border-ink-800/60">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink-700 dark:text-ink-200">{item.label}</td>
                    {ACTIONS.map((a) => (
                      <td key={a.key} className="px-4 py-2.5 text-center">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={!!rolePerms[item.label]?.[a.key]}
                          onChange={() => toggle(item.label, a.key)}
                          className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
                        />
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-center">
                      {rolePerms[item.label]?.view && (
                        <span className="inline-flex rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                          {getDataScope(activeRole, item.label)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <FormModal
        open={createRoleOpen}
        onClose={() => setCreateRoleOpen(false)}
        title="Create Custom Role"
        description="Super Admin can define new roles without changing the application's code — the role will appear on Login, Add User, and this permission matrix immediately."
        submitLabel="Create Role"
        onSubmit={createRole}
        fields={[{ name: 'name', label: 'Role Name', required: true, span: 2, placeholder: 'e.g. Regional Manager' }]}
      />

      <ConfirmDialog
        open={!!deleteRoleTarget}
        onClose={() => setDeleteRoleTarget(null)}
        onConfirm={confirmDeleteRole}
        title="Delete this custom role?"
        description={`"${deleteRoleTarget}" will be removed from Login, Add User, and this permission matrix. Existing users with this role will keep it until reassigned.`}
        confirmLabel="Delete Role"
      />
    </div>
  )
}
