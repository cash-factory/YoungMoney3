#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const projectUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!projectUrl || !serviceRoleKey) {
  throw new Error('Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY through secure environment injection.');
}

let parsedUrl;
try {
  parsedUrl = new URL(projectUrl);
} catch {
  throw new Error('SUPABASE_URL must be a valid HTTPS project URL.');
}
if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
  throw new Error('SUPABASE_URL must be a valid HTTPS project URL without embedded credentials or query parameters.');
}

const storageEndpoint = `${parsedUrl.origin}/storage/v1/bucket`;
const bucketConfiguration = {
  id: 'trading-media',
  name: 'trading-media',
  public: false,
  file_size_limit: 15 * 1024 * 1024,
  allowed_mime_types: [
    'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
    'audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-wav',
  ],
};

async function request(url, method, body) {
  const result = await fetch(url, {
    method,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (result.ok) return result;
  if (method === 'POST' && result.status === 409) return null;
  throw new Error(`Supabase Storage configuration failed (HTTP ${result.status}). Check the project URL and service-role key.`);
}

await request(storageEndpoint, 'POST', bucketConfiguration);
await request(`${storageEndpoint}/trading-media`, 'PUT', {
  public: false,
  file_size_limit: bucketConfiguration.file_size_limit,
  allowed_mime_types: bucketConfiguration.allowed_mime_types,
});

function setWorkerSecret(name, value) {
  const wranglerEnvironment = { ...process.env };
  delete wranglerEnvironment.SUPABASE_ACCESS_TOKEN;
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', name, '--name', 'ym-fx'], {
    input: `${value}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'ignore'],
    env: wranglerEnvironment,
  });
  if (result.status !== 0) throw new Error(`Could not configure Cloudflare Worker secret ${name}.`);
}

setWorkerSecret('SUPABASE_URL', parsedUrl.origin);
setWorkerSecret('SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey);
console.log('Private trading-media bucket and YM-Fx Worker secrets are configured.');
