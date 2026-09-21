import type { APIRoute } from 'astro';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import bcrypt from 'bcryptjs';
import { dynamoDocClient, USERS_TABLE } from '../../../lib/aws/dynamo';
import { createSessionToken, COOKIE_NAME } from '../../../lib/auth/session';
import type { GalaUser } from '../../../lib/types/user';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
    try {
        const body = await request.json();
        const username = body.username?.toString().toLowerCase().trim();
        const password = body.password?.toString();

        if (!username || !password) {
            return new Response(JSON.stringify({ error: 'Credenciales incompletas' }), { status: 400 });
        }

        const result = await dynamoDocClient.send(
            new GetCommand({
                TableName: USERS_TABLE,
                Key: { username },
            })
        );

        const user = result.Item as GalaUser | undefined;
        if (!user) {
            return new Response(JSON.stringify({ error: 'Usuario o clave incorrectos' }), { status: 401 });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return new Response(JSON.stringify({ error: 'Usuario o clave incorrectos' }), { status: 401 });
        }

        const token = await createSessionToken({
            username: user.username,
            name: user.name,
            role: user.role,
        });

        cookies.set(COOKIE_NAME, token, {
            path: '/',
            httpOnly: true,
            secure: import.meta.env.PROD,
            sameSite: 'lax',
            maxAge: 60 * 60 * 12,
        });

        return new Response(JSON.stringify({ success: true, name: user.name }), { status: 200 });
    } catch (error) {
        console.error('Error en login:', error);
        return new Response(JSON.stringify({ error: 'Error interno en el servidor' }), { status: 500 });
    }
};