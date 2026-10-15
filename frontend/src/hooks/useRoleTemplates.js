import { useEffect, useState } from 'react'
import { api } from '../api/http'

/** The role templates the server holds (built-in profiles plus the custom roles the Super Admin added, with her edits). Only the Super Admin may read them. */
export function useRoleTemplates() {
  const [state, setState] = useState({ roles: [], profiles: {}, loaded: false })
  useEffect(() => {
    let alive = true
    api.get('/userAccounts/permission-templates')
      .then((res) => { if (alive) setState({ roles: res.data.roles, profiles: res.data.profiles, loaded: true }) })
      .catch(() => { if (alive) setState((s) => ({ ...s, loaded: true })) })
    return () => { alive = false }
  }, [])
  return state
}
