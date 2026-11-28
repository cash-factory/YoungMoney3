import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

const bundle = await build({entryPoints:['worker/index.ts'],bundle:true,format:'esm',external:['cloudflare:workers'],write:false});
const mf = new Miniflare(convertV4MiniflareOptions({workers:[{
  name:'journal',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2025-12-01',
  durableObjects:{PRIVATE_FILES:{className:'PrivateFiles',useSQLite:true}},d1Databases:['DB']
}],port:0}));
try {
  const db = await mf.getD1Database('DB');
  for (const statement of [
    'CREATE TABLE users(id TEXT PRIMARY KEY,account_status TEXT)',
    'CREATE TABLE sessions(user_id TEXT,token_hash TEXT,expires_at TEXT)',
    'CREATE TABLE active_media_uploads(id TEXT PRIMARY KEY,owner TEXT,expires INTEGER)'
  ]) await db.prepare(statement).run();
  for (const owner of ['alice','bob']) {
    await db.prepare("INSERT INTO users VALUES (?,'active')").bind(owner).run();
    await db.prepare('INSERT INTO sessions VALUES (?,?,?)').bind(owner,createHash('sha256').update(owner).digest('base64'),'2099-01-01').run();
  }
  const request = (url,user,options={}) => mf.dispatchFetch('https://desk.example/api/media/'+url,{
    ...options,headers:{cookie:'__Host-ym_session='+user,...options.headers}
  });
  const path = 'alice/playbook.pdf';
  const payload = Buffer.alloc(1100000,77);
  payload.write('%PDF-1.7');
  const put = {method:'PUT',headers:{'content-type':'application/pdf'},body:payload};
  assert.equal((await request('upload?path='+path,'alice',put)).status,200);
  assert.equal((await request('upload?path='+path,'alice',put)).status,409);
  const file = await request('download?path='+path,'alice');
  assert.equal(file.status,200);
  assert.match(file.headers.get('content-disposition'),/attachment.*playbook.pdf/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),payload);
  assert.equal((await request('download?path='+path,'bob')).status,400);
  assert.equal((await request('download?path='+path,'unknown')).status,401);
  const own = await (await request('page?provider=archive','alice')).json();
  assert.equal(own.files[0].name,'playbook.pdf');
  assert.equal((await (await request('page?provider=archive','bob')).json()).files.length,0);
  assert.equal((await request('upload?path=alice/bad.pdf','alice',{...put,body:'invalid format'})).status,415);
  console.log('Private uploads, multi-chunk round trip, duplicate handling, downloads, isolation and listing passed.');
} finally { await mf.dispose(); }
