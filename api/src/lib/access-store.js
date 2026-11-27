// Storage for client invites and members (Table Storage, same account as the other features).
//   PartitionKey "invite": RowKey = hash of the code; email, portal, readiness, createdAt, expiresAt, usedAt, cancelledAt
//   PartitionKey "member": RowKey = URI-encoded email; email, portal, readiness, addedAt, via
const { TableClient } = require('@azure/data-tables');
const { memberKey, normEmail } = require('./invites');

const TABLE = 'PortalAccess';
let table;

async function getTable() {
  if (table) return table;
  const conn = process.env.CONTACT_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error('CONTACT_STORAGE_CONNECTION_STRING is not set');
  const t = TableClient.fromConnectionString(conn, TABLE);
  await t.createTable(); // no-op if it exists
  table = t;
  return table;
}

/** The member row for an email, or null. Never throws: a storage problem just means "not a member". */
async function getMember(email, log) {
  if (!email) return null;
  try {
    const t = await getTable();
    const row = await t.getEntity('member', memberKey(email));
    return { email: normEmail(row.email), portal: !!row.portal, readiness: !!row.readiness, addedAt: row.addedAt, via: row.via };
  } catch (err) {
    if (err.statusCode !== 404 && log) log('Member lookup failed: ' + (err.message || err));
    return null;
  }
}

module.exports = { getTable, getMember };
