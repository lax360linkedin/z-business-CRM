import { Badge } from '../../components/common/Badge'

const TONE = { Connected: 'success', Error: 'danger', Inactive: 'neutral', 'Not Connected': 'warning' }

/** Connection status of a source's integration, exactly as the Integrations module last reported it. */
export const IntegrationBadge = ({ status }) => <Badge tone={TONE[status] || 'neutral'} className="whitespace-nowrap">{status}</Badge>
