import { Fragment, useCallback, useEffect, useState } from 'react'
import { RotateCcw, Save, ShieldCheck, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/common/PageHeader'
import { Tabs } from '../../components/common/Tabs'
import { Button } from '../../components/common/Button'
import { FormModal } from '../../components/common/FormModal'
import { ConfirmDialog } from '../../components/common/ConfirmDialog'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { api, errorMessage } from '../../api/http'
import { NAV_SECTIONS } from '../../routes/navConfig'
import { ACTIONS, FULL } from '../../data/permissions'
import { getDataScope } from '../../data/dataScope'

export default function RolesPermissions() {
  const [roles, setRoles] = useState(['Super Admin'])
  const [builtIn, setBuiltIn] = useState([])
  const [permissions, setPermissions] = useState({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeRole, setActiveRole] = useState('Super Admin')
  const [createRoleOpen, setCreateRoleOpen] = useState(false)
  const [deleteRoleTarget, setDeleteRoleTarget] = useState(null)
  const { toast } = useToast()
  const { hasPermission } = useAuth()
  const fixedRole = ['Super Admin', 'Admin'].includes(activeRole) // these two templates are fixed by the server
  const canEdit = hasPermission('Roles & Permissions', 'edit') && !fixedRole
  const isCustomRole = !!activeRole && !builtIn.includes(activeRole) && activeRole !== 'Super Admin'

  const apply = useCallback((data, keepActive) => {
    setRoles(['Super Admin', ...data.roles])
    setBuiltIn(data.builtIn)
    const all = { ...data.permissions }
    all['Super Admin'] = Object.fromEntries(Object.keys(data.permissions.Admin || {}).map((m) => [m, { ...FULL }]))
    setPermissions(all)
    setDirty(false)
    setActiveRole((cur) => (keepActive && (cur === 'Super Admin' || data.roles.includes(cur)) ? cur : 'Super Admin'))
  }, [])

  useEffect(() => {
    api.get('/roles').then((res) => apply(res.data, true)).catch((e) => toast(errorMessage(e), { type: 'error' }))
  }, [apply]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (label, actionKey) => {
    if (!canEdit) return
    setDirty(true)
    setPermissions((prev) => ({
      ...prev,
      [activeRole]: {
        ...prev[activeRole],
        [label]: { ...prev[activeRole]?.[label], [actionKey]: !prev[activeRole]?.[label]?.[actionKey] },
      },
    }))
  }

  const run = (request, success) => {
    setSaving(true)
    return request.then((res) => { apply(res.data, true); toast(success, { type: 'success' }); return res }).catch((e) => { toast(errorMessage(e), { type: 'error' }); throw e }).finally(() => setSaving(false))
  }

  const resetRole = () => run(api.post(`/roles/${encodeURIComponent(activeRole)}/reset`), `Permissions for "${activeRole}" reset to defaults.`).catch(() => null)
  const saveChanges = () => run(api.put(`/roles/${encodeURIComponent(activeRole)}/permissions`, { permissions: permissions[activeRole] }), `Permissions saved for "${activeRole}". Accounts on this role follow it from their next request.`).catch(() => null)
  const createRole = (data) => run(api.post('/roles', { name: data.name, copyFrom: 'Employee' }), `Template "${data.name}" created. Pick it when adding a user.`)
    .then(() => { setActiveRole(data.name.trim()); setCreateRoleOpen(false) }).catch(() => null)
  const confirmDeleteRole = () => run(api.delete(`/roles/${encodeURIComponent(deleteRoleTarget)}`), `Custom role "${deleteRoleTarget}" removed.`)
    .then(() => { if (activeRole === deleteRoleTarget) setActiveRole('Super Admin') }).catch(() => null).finally(() => setDeleteRoleTarget(null))

  const rolePerms = permissions[activeRole] || {}

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        description="Permission templates: the starting permissions for Admin, Employee and each job profile. Only the Super Admin can change them; individual accounts are tuned in User Management."
        actions={
          <>
            {canEdit && <Button variant="secondary" icon={Plus} onClick={() => setCreateRoleOpen(true)}>New template</Button>}
            <Button variant="secondary" icon={RotateCcw} onClick={resetRole} disabled={!canEdit || saving}>Reset to Defaults</Button>
            <Button icon={Save} onClick={saveChanges} disabled={!canEdit || !dirty} loading={saving}>Save Changes</Button>
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
          {activeRole === 'Super Admin' ? 'The Super Admin always has full access to every module and cannot be restricted.' : activeRole === 'Admin' ? 'The Admin template is fixed: full operational access to every module except User Management, Roles & Permissions and Branches.' : <>Editing the <span className="font-semibold">{activeRole}</span> template{isCustomRole && ' (custom)'}. Accounts that already have their own permission set are not affected. Changes are saved to this browser automatically.</>}
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
        title="New permission template"
        description="A template is a starting set of permissions you can pick when creating an account. It is not a login role: people always sign in as Super Admin, Admin or Employee."
        submitLabel="Create Role"
        onSubmit={createRole}
        fields={[{ name: 'name', label: 'Template name', required: true, span: 2, placeholder: 'e.g. Regional Manager' }]}
      />

      <ConfirmDialog
        open={!!deleteRoleTarget}
        onClose={() => setDeleteRoleTarget(null)}
        onConfirm={confirmDeleteRole}
        title="Delete this template?"
        description={`"${deleteRoleTarget}" will be removed from Add User and this matrix. Accounts created from it keep the permissions they were given.`}
        confirmLabel="Delete template"
      />
    </div>
  )
}
