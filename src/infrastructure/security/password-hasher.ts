import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;

export const hashPassword = (password: string): { hash: string; salt: string } => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return { hash, salt };
};

export const verifyPassword = (password: string, hash: string, salt: string): boolean => {
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const target = Buffer.from(hash, 'hex');
  if (derived.byteLength !== target.byteLength) {
    return false;
  }
  return timingSafeEqual(derived, target);
};
