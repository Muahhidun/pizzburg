import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt64, expected64] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt64 || !expected64) return false;
  const expected = Buffer.from(expected64, 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  const actual = (await scrypt(password, Buffer.from(salt64, 'base64'), KEY_LENGTH)) as Buffer;
  return timingSafeEqual(expected, actual);
}
