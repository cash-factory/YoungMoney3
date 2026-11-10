import assert from 'node:assert/strict';
import test from 'node:test';
import {connectorDownload} from '../worker/connectorDownload.ts';
test('connector download streams an exact archive and rejects invalid manifests',async()=>{
  const one=new TextEncoder().encode('first'),two=new TextEncoder().encode('second');
  const manifest={size:11,sha256:'a'.repeat(64),parts:['/downloads/connector-aaaaaaaaaaaa-0.part','/downloads/connector-aaaaaaaaaaaa-1.part']};
  const env={ASSETS:{fetch:async req=>{
    const p=new URL(req.url).pathname;
    if(p.endsWith('.json'))return Response.json(manifest);
    return new Response(p.endsWith('-0.part')?one:two);
  }}};
  const response=await connectorDownload(new Request('https://stage.example/downloads/YoungMoney3-Connector.zip'),env);
  assert.equal(await response.text(),'firstsecond');
  assert.equal(response.headers.get('X-Archive-SHA256'),manifest.sha256);
  manifest.parts=['https://production.example/anything'];
  assert.equal((await connectorDownload(new Request('https://stage.example/downloads/YoungMoney3-Connector.zip'),env)).status,503);
});
