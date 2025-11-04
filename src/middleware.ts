import type { MiddlewareNext } from 'astro';
import { verifyJwt } from './utils/jwt';

export const onRequest = async (context: {
  request: Request;
  locals: Record<string, unknown>;
  url: URL;
  cookies: import('astro').AstroCookies;
}, next: MiddlewareNext) => {
  const { url, cookies } = context;
  const pathname = url.pathname;

  // Allow login routes and static assets without auth
  const isAuthRoute = pathname === '/login' || pathname === '/api/login' || pathname === '/api/logout';
  const isAsset = pathname.startsWith('/favicon') || pathname.startsWith('/_astro/') || pathname.startsWith('/assets/') || pathname.startsWith('/public/');
  if (!isAuthRoute && !isAsset) {
    const token = cookies.get('auth')?.value;
    if (!token) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/login',
          'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
          'Cache-Control': 'no-store',
        },
      });
    }

    try {
      const secret = import.meta.env.PUBLIC_JWT_SECRET || 'secret';
      await verifyJwt(token, secret);
    } catch {
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/login',
          'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  const response = await next();
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  response.headers.set('Cache-Control', 'no-store');
  return response;
};


