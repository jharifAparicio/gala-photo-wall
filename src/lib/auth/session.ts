import { SignJWT, jwtVerify } from 'jose';
import type { SessionPayload } from '../types/user';

const secretString = import.meta.env.SESSION_SECRET;
const SECRET_KEY = new TextEncoder().encode(secretString);

export const COOKIE_NAME = 'admin_session';

export async function createSessionToken(payload: SessionPayload): Promise<string> {
    return await new SignJWT({ ...payload })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('12h') // Duración de la noche
        .sign(SECRET_KEY);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
    try {
        const { payload } = await jwtVerify(token, SECRET_KEY);
        return payload as unknown as SessionPayload;
    } catch {
        return null;
    }
}