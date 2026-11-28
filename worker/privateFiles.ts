import { DurableObject } from 'cloudflare:workers';

// The Worker chooses the object from the authenticated account ID. File content
// lives in this separate SQLite store, outside the journal database.
export class PrivateFiles extends DurableObject {
  private get sql() {
    return this.ctx.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || '';
    if (request.method === 'DELETE') {
      await this.ctx.storage.deleteAll();
      return new Response(null, {status: 204});
    }
    this.sql.exec('CREATE TABLE IF NOT EXISTS files (name TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, created TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (name TEXT NOT NULL, ordinal INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(name, ordinal))');
    if (url.pathname === '/list') {
      const after = url.searchParams.get('after') || '';
      const limit = Math.min(11000, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      const rows = this.sql.exec<{name:string; mime:string; created:string}>(
        'SELECT name,mime,created FROM files WHERE name > ? ORDER BY name LIMIT ?', after, limit + 1
      ).toArray();
      const files = rows.slice(0, limit).map(row => ({name:row.name, id:row.name, created_at:row.created, metadata:{mimetype:row.mime}}));
      return Response.json({files, folders:[], next:rows.length > limit ? files[files.length - 1].name : null});
    }
    if (!name) return new Response(null, {status:400});
    if (request.method === 'PUT') {
      const data = await request.arrayBuffer();
      if (!data.byteLength || data.byteLength > 15 * 1024 * 1024) return new Response(null, {status:413});
      return this.ctx.storage.transactionSync(() => {
        if (this.sql.exec('SELECT 1 FROM files WHERE name=?',name).toArray().length) return Response.json({error:'File already exists.'},{status:409});
        this.sql.exec('INSERT INTO files VALUES (?,?,?,?)',name,request.headers.get('content-type') || 'application/octet-stream',data.byteLength,new Date().toISOString());
        const chunkSize = 512 * 1024;
        for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
          this.sql.exec('INSERT INTO chunks VALUES (?,?,?)',name,offset,data.slice(offset,offset+chunkSize));
        }
        return Response.json({name});
      });
    }
    const file = this.sql.exec<{mime:string; size:number}>('SELECT mime,size FROM files WHERE name=?',name).toArray()[0];
    if (!file) return new Response(null,{status:404});
    const parts = this.sql.exec<{data:ArrayBuffer}>('SELECT data FROM chunks WHERE name=? ORDER BY ordinal',name);
    const body = new Uint8Array(file.size);
    let offset = 0;
    for (const {data} of parts) {body.set(new Uint8Array(data),offset); offset += data.byteLength;}
    return new Response(body,{headers:{'content-type':file.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  }
}
