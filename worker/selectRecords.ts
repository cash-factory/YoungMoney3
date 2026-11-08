interface Query {
  table:string; filters?:Record<string,unknown>; membershipFilters?:Record<string,unknown[]>; or?:string;
  order?:{column:string;ascending?:boolean}; limit?:number; page?:number; head?:boolean;
}
function column(name:string) {
  if(!/^[a-z][a-z_0-9]{0,63}$/.test(name)) throw Error('Invalid query column.');
  if(['id','user_id','created_at','updated_at'].includes(name)) return name;
  return "json_extract(payload,'$."+name+"')";
}
export async function selectRecords(db:D1Database, owner:unknown, input:Query) {
  const conditions=['user_id=?','table_name=?'], args:unknown[]=[owner,input.table];
  for(const [key,value] of Object.entries(input.filters||{})) {
    conditions.push(column(key)+' IS ?'); args.push(value);
  }
  for(const [key,values] of Object.entries(input.membershipFilters||{})) {
    conditions.push(column(key)+' IN (SELECT value FROM json_each(?))');args.push(JSON.stringify(values));
  }
  if(input.or){
    const match=/^([a-z_]+)\.is\.null,([a-z_]+)\.eq\.([a-zA-Z0-9_-]+)$/.exec(input.or);
    if(!match||match[1]!==match[2]) throw Error('Invalid filter.');
    const field=column(match[1]); conditions.push('('+field+' IS NULL OR '+field+'=?)');args.push(match[3]);
  }
  const where=' FROM workspace_records WHERE '+conditions.join(' AND ');
  const total=await db.prepare('SELECT COUNT(*) AS n'+where).bind(...args).first<number>('n') ?? 0;
  if(input.head) return {data:[],count:total};
  const page=input.page ?? 0;
  if(!Number.isSafeInteger(page)||page<0) throw Error('Invalid page.');
  const size=200, wanted=input.limit === undefined ? total : Math.min(input.limit,1000);
  const limit=Math.min(size,Math.max(0,wanted-page*size));
  const sort=column(input.order?.column || 'created_at'), dir=input.order?.ascending===false||!input.order?' DESC':' ASC';
  const rows=await db.prepare('SELECT id,payload,created_at,updated_at'+where+' ORDER BY '+sort+dir+',id'+dir+' LIMIT ? OFFSET ?').bind(...args,limit,page*size).all<{id:string;payload:string;created_at:string;updated_at:string}>();
  return {data:rows.results.map(({payload,...row})=>({...JSON.parse(payload),...row,user_id:owner})),count:total,
    nextPage:(page+1)*size<Math.min(total,wanted)?page+1:null};
}
