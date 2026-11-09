import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertHealthReply({ status, contentType, body }) {
  if (status !== 200 || !/application\/json/i.test(contentType || '')) {
    throw Error('Staging /api/health returned a non-JSON response or non-200 status.');
  }
  let payload;
  try { payload = JSON.parse(body); }
  catch { throw Error('Staging /api/health did not return valid JSON.'); }
  if (payload?.status !== 'ok' || payload?.database !== 'connected') {
    throw Error('Staging /api/health did not confirm a connected D1 database.');
  }
  return true;
}

export function validateStagingUrl(url, workerName) {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
    parsed.pathname !== '/' || parsed.search || parsed.hash ||
    !hostname.startsWith(workerName.toLowerCase()+'.') || !hostname.endsWith('.workers.dev')) {
    throw Error('Refusing health check against a non-matching staging Workers URL.');
  }
  return parsed.origin;
}

export async function checkHealth(url, workerName) {
  const origin = validateStagingUrl(url, workerName);
  const probes = [
    {name:'normal HTTP API request',headers:{Accept:'application/json'}},
    {name:'browser-style page navigation',headers:{Accept:'text/html','Sec-Fetch-Mode':'navigate'}},
  ];
  for (const probe of probes) {
    let lastError;
    for(let attempt=0;attempt<6;attempt++){
      try {
        const r=await fetch(origin+'/api/health',{headers:probe.headers,signal:AbortSignal.timeout(8000)});
        assertHealthReply({status:r.status,contentType:r.headers.get('content-type'),body:await r.text()});
        lastError=null;
        break;
      }catch(error){
        lastError=error;
        if(attempt<5)await new Promise(resolve=>setTimeout(resolve,1500));
      }
    }
    if(lastError)throw Error('Health verification failed for '+probe.name+': '+String(lastError.message || lastError));
    console.log('Passed staging health check: '+probe.name+'.');
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const url=process.env.YM3_STAGING_URL;
  const worker=process.env.YM3_STAGING_WORKER_NAME?.trim() || 'ym-fx-staging';
  if(!url)throw Error('YM3_STAGING_URL must be the staging URL from Wrangler deploy output.');
  await checkHealth(url,worker);
}
