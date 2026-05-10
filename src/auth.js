import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import dotenv from 'dotenv';
dotenv.config();
const scrypt = promisify(scryptCallback);
const jwtSecret = process.env.JWT_SECRET || 'change-this-secret';
const tokenLifetimeSeconds = 60 * 60 * 24 * 3;
const base64Url = (value) => Buffer
    .from(value)
    .toString('base64url');
export const hashPassword = async (password) => {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = await scrypt(password, salt, 64);
    return `${salt}:${derivedKey.toString('hex')}`;
};
export const verifyPassword = async (password, passwordHash) => {
    const [salt, key] = passwordHash.split(':');
    if (!salt || !key) {
        return false;
    }
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = await scrypt(password, salt, 64);
    return keyBuffer.length === derivedKey.length && timingSafeEqual(keyBuffer, derivedKey);
};
export const signToken = (payload) => {
    const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64Url(JSON.stringify({
        ...payload,
        exp: Math.floor(Date.now() / 1000) + tokenLifetimeSeconds,
    }));
    const signature = createHmac('sha256', jwtSecret)
        .update(`${header}.${body}`)
        .digest('base64url');
    return `${header}.${body}.${signature}`;
};
export const verifyToken = (token) => {
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
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('Token expired.');
    }
    return payload;
};
//# sourceMappingURL=auth.js.map