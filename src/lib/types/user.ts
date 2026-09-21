export interface GalaUser {
    username: string;
    password_hash: string;
    name: string;
    role: 'ADMIN' | 'JURY';
    created_at: number;
}

export interface SessionPayload {
    username: string;
    name: string;
    role: string;
}