import { DurableObject } from 'cloudflare:workers';
import { hashPassword, verifyPassword } from './passwords';

// Staging-only private authentication compute. A Durable Object has a
// separate 30s CPU budget on Workers Free; the incoming Worker has 10ms.
// No credentials or verifier state are persisted in this object.
// Only the Worker holding the private AUTH_KDF binding can invoke fetch().
export class AuthKdf extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return Response.json({error:'Not found'}, {status:404});
    let fields: unknown;
    try { fields = await request.json(); }
    catch { return Response.json({error:'Invalid request'}, {status:400}); }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields))
      return Response.json({error:'Invalid request'}, {status:400});
    const input = fields as Record<string, unknown>;
    if (typeof input.password !== 'string' || input.password.length > 4096)
      return Response.json({error:'Invalid request'}, {status:400});
    try {
      if (input.action === 'hash') {
        if (input.password.length > 256 || input.password.length < 8)
          return Response.json({error:'Invalid password'}, {status:400});
        return Response.json(await hashPassword(input.password));
      }
      if (input.action === 'verify')
        return Response.json(await verifyPassword(input.password, input.salt, input.hash));
    } catch (error) {
      // Never log the password, salt, verifier or request JSON.
      console.error('KDF service failed', { errorType: error instanceof Error ? error.name : typeof error });
      return Response.json({error:'Authentication compute unavailable'}, {status:503});
    }
    return Response.json({error:'Not found'}, {status:404});
  }
}
