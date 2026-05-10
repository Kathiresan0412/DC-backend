import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import dotenv from 'dotenv';

dotenv.config();

const scrypt = promisify(scryptCallback);
const jwtSecret = process.env.JWT_SECRET || 'change-this-secret';

const base64Url = (value: Buffer | string) => Buffer
  .from(value)
  .toString('base64url');

export type AuthTokenPayload = {
  sub: string;
  email: string;
  role: string;
  exp: number;
};

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64) as Buffer;

  return `${salt}:${derivedKey.toString('hex')}`;
};

export const verifyPassword = async (password: string, passwordHash: string) => {
  const [salt, key] = passwordHash.split(':');

  if (!salt || !key) {
    return false;
  }

  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = await scrypt(password, salt, 64) as Buffer;

  return keyBuffer.length === derivedKey.length && timingSafeEqual(keyBuffer, derivedKey);
};

export const signToken = (payload: Omit<AuthTokenPayload, 'exp'>) => {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
  }));
  const signature = createHmac('sha256', jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
};

export const verifyToken = (token: string) => {
  const [header, body, signature] = token.split('.');

  if (!header || !body || !signature) {
    throw new Error('Invalid token.');
  }

  const expectedSignature = createHmac('sha256', jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url');

  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error('Invalid token signature.');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AuthTokenPayload;

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired.');
  }

  return payload;
};
