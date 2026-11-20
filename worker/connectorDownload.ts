interface AssetsEnv { ASSETS?: Fetcher }
type DownloadManifest = { filename: string; size: number; sha256: string; parts: string[] };

export async function connectorDownload(request: Request, env: AssetsEnv): Promise<Response> {
  if (!env.ASSETS) return new Response('Connector download unavailable.', {status: 503});
  if (!['GET','HEAD'].includes(request.method)) return new Response('Method unavailable.', {status:405});
  const url = new URL(request.url);
  const manifestReply = await env.ASSETS.fetch(new Request(new URL('/downloads/connector-manifest.json', url),{method:'GET'}));
  if (!manifestReply.ok) return new Response('Connector build not published yet.', {status:503});
  const manifest = await manifestReply.json() as DownloadManifest;
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0 || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || !Array.isArray(manifest.parts) || manifest.parts.length > 16
    || !manifest.parts.every(p => p.startsWith('/downloads/connector-') && /^[a-f0-9]{12}-[0-9]+[.]part$/.test(p.slice('/downloads/connector-'.length)))) {
    return new Response('Invalid connector build manifest.', {status:503});
  }
  const assets = env.ASSETS;
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let received = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          if (!reader) {
            if (index === manifest.parts.length) {
              if (received !== manifest.size) throw new Error('Incomplete connector archive.');
              controller.close();
              return;
            }
            const part = await assets.fetch(new Request(new URL(manifest.parts[index++], url), {method:'GET'}));
            if (!part.ok || !part.body) throw new Error('Connector archive part missing.');
            reader = part.body.getReader();
          }
          const piece = await reader.read();
          if (piece.done) {reader.releaseLock(); reader = null; continue;}
          received += piece.value.byteLength;
          controller.enqueue(piece.value);
          return;
        }
      } catch (error) {controller.error(error);}
    },
    async cancel() {await reader?.cancel();},
  });
  return new Response(request.method === 'HEAD' ? null : stream, {
    headers: {
      'Content-Type':'application/zip',
      'Content-Disposition':'attachment; filename="YoungMoney3-Connector.zip"',
      'Content-Length':String(manifest.size),
      'Cache-Control':'public, max-age=300',
      'X-Content-Type-Options':'nosniff',
      'ETag':'"'+manifest.sha256+'"',
      'X-Archive-SHA256':manifest.sha256,
    },
  });
}
