const test = require('node:test');
const assert = require('node:assert');
const { isAdmin } = require('../src/functions/comments');

const req = p => ({ headers: { get: h => (h === 'x-ms-client-principal' && p ? Buffer.from(JSON.stringify(p)).toString('base64') : null) } });
const env = { ADMIN_EMAILS: 'Taz@CloudShiftLabs.net, other@example.com' };
const user = (email, roles = ['anonymous', 'authenticated']) => ({ userDetails: email, userRoles: roles });

test('listed email is admin, any case', () => assert.ok(isAdmin(req(user('taz@cloudshiftlabs.net')), env)));
test('second listed email is admin', () => assert.ok(isAdmin(req(user('other@example.com')), env)));
test('unlisted email is not admin', () => assert.ok(!isAdmin(req(user('someone@else.com')), env)));
test('signed out is not admin', () => assert.ok(!isAdmin(req(null), env)));
test('empty setting lets nobody in', () => assert.ok(!isAdmin(req(user('taz@cloudshiftlabs.net')), {})));
test('admin role still works', () => assert.ok(isAdmin(req(user('x@y.com', ['authenticated', 'admin'])), {})));
test('garbage header is not admin', () => assert.ok(!isAdmin({ headers: { get: () => 'not-base64-json' } }, env)));
