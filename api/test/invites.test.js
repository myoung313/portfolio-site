const test = require('node:test');
const assert = require('node:assert');
const I = require('../src/lib/invites');
const { checkAccess, hasReadiness, parseAllowList } = require('../src/lib/portal');

const user = (email, roles = ['anonymous', 'authenticated']) => ({ identityProvider: 'aad', userId: 'u', userDetails: email, userRoles: roles });
const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();
const invite = (o = {}) => ({ rowKey: 'h', email: 'owner@brightdental.com', portal: true, readiness: false, expiresAt: future, ...o });

test('codes are 22 url-safe chars and unique', () => {
  const a = I.newCode(), b = I.newCode();
  assert.ok(I.looksLikeCode(a)); assert.notStrictEqual(a, b);
});
test('hash is stable, hex, and not the code', () => {
  const c = I.newCode();
  assert.strictEqual(I.hashCode(c), I.hashCode(c));
  assert.match(I.hashCode(c), /^[0-9a-f]{64}$/);
  assert.ok(!I.hashCode(c).includes(c));
});
test('rejects junk codes', () => {
  for (const c of ['', 'short', 'a/b' + 'x'.repeat(19), null]) assert.strictEqual(I.looksLikeCode(c), false);
});

test('validate: needs a real email', () => assert.ok(I.validateInvite({ email: 'nope' }).error));
test('validate: lowercases email, defaults portal on and 7 days', () => {
  assert.deepStrictEqual(I.validateInvite({ email: ' Owner@BrightDental.com ' }), { email: 'owner@brightdental.com', portal: true, readiness: false, days: 7 });
});
test('validate: needs at least one access', () => assert.ok(I.validateInvite({ email: 'a@b.co', portal: false, readiness: false }).error));
test('validate: odd day counts fall back to 7', () => assert.strictEqual(I.validateInvite({ email: 'a@b.co', days: 999 }).days, 7));
test('validate: refuses emails with key-breaking characters', () => assert.ok(I.validateInvite({ email: 'a/b@c.co' }).error));

test('state: pending, used, cancelled, expired, missing', () => {
  assert.strictEqual(I.inviteState(invite()), 'pending');
  assert.strictEqual(I.inviteState(invite({ usedAt: past })), 'used');
  assert.strictEqual(I.inviteState(invite({ cancelledAt: past })), 'cancelled');
  assert.strictEqual(I.inviteState(invite({ expiresAt: past })), 'expired');
  assert.strictEqual(I.inviteState(null), 'missing');
});

test('redeem: right email works, any case', () => assert.strictEqual(I.redeemCheck(invite(), 'OWNER@brightdental.com').ok, true));
test('redeem: wrong account is refused with a masked hint', () => {
  const r = I.redeemCheck(invite(), 'someone@outlook.com');
  assert.strictEqual(r.reason, 'wrong_account'); assert.ok(r.error.includes('o'));
  assert.ok(!r.error.includes('owner@'));
});
test('redeem: expired, cancelled and missing are refused', () => {
  assert.strictEqual(I.redeemCheck(invite({ expiresAt: past }), 'owner@brightdental.com').reason, 'expired');
  assert.strictEqual(I.redeemCheck(invite({ cancelledAt: past }), 'owner@brightdental.com').reason, 'cancelled');
  assert.strictEqual(I.redeemCheck(null, 'owner@brightdental.com').reason, 'invalid');
});
test('redeem: used link is fine for its owner, refused for others', () => {
  assert.strictEqual(I.redeemCheck(invite({ usedAt: past }), 'owner@brightdental.com').already, true);
  assert.strictEqual(I.redeemCheck(invite({ usedAt: past }), 'x@y.co').reason, 'used');
});

test('mask hides most of the name', () => assert.strictEqual(I.maskEmail('owner@brightdental.com'), 'o****@brightdental.com'));
test('member key escapes odd characters', () => assert.strictEqual(I.memberKey('A+b@c.co'), 'a%2Bb%40c.co'));
test('merge access only adds', () => assert.deepStrictEqual(I.mergeAccess({ portal: true, readiness: false }, { portal: false, readiness: true }), { portal: true, readiness: true }));

// Stored members (from invite links) in the access checks
const none = parseAllowList('');
test('member with portal gets into the portal', () => {
  const r = checkAccess(user('owner@brightdental.com'), none, {}, { email: 'owner@brightdental.com', portal: true, readiness: false });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.readiness, false);
});
test('member with readiness only still gets into the portal, with readiness', () => {
  const r = checkAccess(user('m@a.co'), none, {}, { email: 'm@a.co', portal: false, readiness: true });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.readiness, true);
});
test("someone else's member row does not count", () => {
  assert.strictEqual(checkAccess(user('x@y.co'), none, {}, { email: 'owner@brightdental.com', portal: true }).status, 403);
  assert.strictEqual(hasReadiness(user('x@y.co'), {}, { email: 'owner@brightdental.com', readiness: true }), false);
});
test('no member and no lists is 403', () => assert.strictEqual(checkAccess(user('x@y.co'), none, {}, null).status, 403));
