// Notifications are created by the server, in the same transaction as the event they describe (a status change, an assignment, a reminder). The browser only reads them.
export function createNotification() { return Promise.resolve(null) }
