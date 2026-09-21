import { defineMiddleware } from 'astro:middleware';
import { verifySessionToken, COOKIE_NAME } from './lib/auth/session';

export const onRequest = defineMiddleware(async ({ url, cookies, locals, redirect }, next) => {
    const isAdminPage = url.pathname.startsWith('/admin');
    const isAdminApi = url.pathname.startsWith('/api/admin');

    if (isAdminPage || isAdminApi) {
        const token = cookies.get(COOKIE_NAME)?.value;

        if (!token) {
            if (isAdminApi) {
                return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
            }
            return redirect('/login');
        }

        const session = await verifySessionToken(token);
        if (!session) {
            cookies.delete(COOKIE_NAME, { path: '/' });
            if (isAdminApi) {
                return new Response(JSON.stringify({ error: 'Sesión expirada' }), { status: 401 });
            }
            return redirect('/login');
        }

        locals.user = session;
    }

    return next();
});