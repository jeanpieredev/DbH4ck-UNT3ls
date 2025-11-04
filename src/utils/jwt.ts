const encoder = new TextEncoder();

function toBase64Url(input: ArrayBuffer): string {
  const bytes = new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function jsonToBase64Url(obj: unknown): string {
  const json = JSON.stringify(obj);
  const b64 = typeof btoa !== 'undefined' ? btoa(json) : Buffer.from(json, 'utf8').toString('base64');
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJwt(payload: Record<string, unknown>, maxAgeSeconds: number, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + maxAgeSeconds };

  const encodedHeader = jsonToBase64Url(header);
  const encodedPayload = jsonToBase64Url(fullPayload);
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const encodedSignature = toBase64Url(signature);
  return `${data}.${encodedSignature}`;
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await importHmacKey(secret);
  const signatureBytes = Uint8Array.from(atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(data));
  if (!valid) throw new Error('Invalid signature');

  const payloadJson = typeof atob !== 'undefined'
    ? atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'))
    : Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const payload = JSON.parse(payloadJson);

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) throw new Error('Token expired');
  return payload;
}


