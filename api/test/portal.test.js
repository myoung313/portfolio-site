const test = require('node:test');
const assert = require('node:assert');
const { parsePrincipal, parseAllowList, checkAccess } = require('../src/lib/portal');

const enc = o => Buffer.from(JSON.stringify(o)).toString('base64');
const user = (email, roles = ['anonymous', 'authenticated']) => ({ identityProvider: 'aad', userId: 'u', userDetails: email, userRoles: roles });
const list = parseAllowList('tyoung@cloudshiftlabs.net; Client@Example.com, other@x.org');

test('parses a principal header', () => assert.strictEqual(parsePrincipal(enc(user('a@b.c'))).userDetails, 'a@b.c'));
test('missing header is null', () => assert.strictEqual(parsePrincipal(null), null));
test('garbage header is null', () => assert.strictEqual(parsePrincipal('not base64 json'), null));
test('allow list splits on comma, semicolon and space', () => assert.deepStrictEqual([...list], ['tyoung@cloudshiftlabs.net', 'client@example.com', 'other@x.org']));
test('empty allow list', () => assert.strictEqual(parseAllowList(undefined).size, 0));
test('anonymous gets 401', () => assert.strictEqual(checkAccess(null, list).status, 401));
test('listed email gets 200', () => assert.strictEqual(checkAccess(user('tyoung@cloudshiftlabs.net'), list).status, 200));
test('email match ignores case', () => assert.strictEqual(checkAccess(user('CLIENT@example.com'), list).status, 200));
test('unlisted email gets 403', () => assert.strictEqual(checkAccess(user('someone@outlook.com'), list).status, 403));
test('client role from an invite still works', () => assert.strictEqual(checkAccess(user('x@y.z', ['authenticated', 'client']), list).status, 200));
test('lookalike email is not a match', () => assert.strictEqual(checkAccess(user('tyoung@cloudshiftlabs.net.evil.com'), list).status, 403));
