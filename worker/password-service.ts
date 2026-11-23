import { hashPassword, verifyPassword } from './passwords';

export interface PasswordComputeEnv { AUTH_KDF?: DurableObjectNamespace; }
type Secured = Awaited<ReturnType<typeof hashPassword>>;
type Verified = Awaited<ReturnType<typeof verifyPassword>>;

async function compute(env: PasswordComputeEnv, subject: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const namespace = env.AUTH_KDF;
  if (!namespace) throw Error('Authentication compute binding unavailable.');
  // Isolate accounts across private DO instances without exposing their
  // addresses, emails, passwords or verifiers in DO names or public URLs.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject)));
  const name = Array.from(digest.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('');
  const stub = namespace.get(namespace.idFromName('account-' + name));
  const reply = await stub.fetch('https://auth-kdf.internal/derive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!reply.ok) throw Error('Isolated authentication compute failed with HTTP ' + reply.status);
  return await reply.json() as Record<string, unknown>;
}

export async function hashPasswordForEnv(env: PasswordComputeEnv, password: string, subject: string): Promise<Secured> {
  if (!env.AUTH_KDF) return hashPassword(password); // Local test / unconfigured environment only.
  const result = await compute(env, subject, { action: 'hash', password });
  if (typeof result.hash !== 'string' || typeof result.salt !== 'string') throw Error('Malformed password hash response.');
  return { hash: result.hash, salt: result.salt };
}

export async function verifyPasswordForEnv(env: PasswordComputeEnv, password: string, salt: unknown, hash: unknown, subject: string): Promise<Verified> {
  if (!env.AUTH_KDF) return verifyPassword(password, salt, hash); // Local test / unconfigured environment only.
  const result = await compute(env, subject, { action: 'verify', password, salt, hash });
  if (typeof result.valid !== 'boolean' || typeof result.needsUpgrade !== 'boolean') throw Error('Malformed password verifier response.');
  return { valid: result.valid, needsUpgrade: result.needsUpgrade };
}
