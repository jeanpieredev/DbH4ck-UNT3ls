import type { APIRoute } from 'astro';
import { signJwt } from '../../utils/jwt';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const formData = await ctx.request.formData();
  const username = String(formData.get('username') || '');
  const password = String(formData.get('password') || '');

  const expectedUser = import.meta.env.PUBLIC_AUTH_USER;
  const expectedPass = import.meta.env.PUBLIC_AUTH_PASS;

  const ok = username === expectedUser && password === expectedPass;
  if (!ok) {
    return ctx.redirect('/login?error=1');
  }

  // Genera un token JWT de 12h de duración y lo guarda en cookie HttpOnly
  const maxAge = 60 * 60 * 12; // 12h
  const secret = import.meta.env.PUBLIC_JWT_SECRET || 'secret';
  const token = await signJwt({ sub: username }, maxAge, secret);
  ctx.cookies.set('auth', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge,
  });

  return ctx.redirect('/');
};


