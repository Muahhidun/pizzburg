import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, verifyPassword } from '../src/admin/password';

test('пароль сотрудника хранится как scrypt-хэш', async () => {
  const encoded = await hashPassword('cashier-secret');
  assert.notEqual(encoded, 'cashier-secret');
  assert.match(encoded, /^scrypt\$/);
  assert.equal(await verifyPassword('cashier-secret', encoded), true);
  assert.equal(await verifyPassword('wrong-secret', encoded), false);
});

test('повреждённый хэш не пропускает вход', async () => {
  assert.equal(await verifyPassword('anything', 'plain-text'), false);
});
