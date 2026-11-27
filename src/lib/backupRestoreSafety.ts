/** Guardrail: workspace JSON is not authoritative MT5 broker evidence.
 * Check all broker-derived projection IDs against authenticated server records
 * BEFORE any media upload or table upsert. Never restore/overwrite those rows.
 */
type Row = Record<string, unknown>;
type ServerRow = {id:string; trade_source?: string | null};

export function restorableWorkspaceRows(table:string,rows:Row[]):Row[] {
  return table === 'trades' ? rows.filter(row => row.trade_source !== 'mt5') : rows;
}

export async function assertExistingBrokerProjections(
  tradeRows:Row[], lookup:(ids:string[])=>Promise<ServerRow[]>,
):Promise<number> {
  const brokerRows=tradeRows.filter(row=>row.trade_source==='mt5');
  const seen=new Set<string>();
  for(let start=0;start<brokerRows.length;start+=100){
    const page=brokerRows.slice(start,start+100);
    const ids:string[]=[];
    for(const record of page){
      const id=record.id;
      if(typeof id!=='string' || id.length===0 || id.length>120 || seen.has(id))
        throw new Error('Archive contains invalid or duplicate MT5 trade identities. No data was changed.');
      seen.add(id);
      ids.push(id);
    }
    const rows=await lookup(ids);
    const present=new Set(rows.filter(row=>row.trade_source==='mt5').map(row=>row.id));
    if(ids.some(id=>!present.has(id)))
      throw new Error('Broker-derived trades are missing from this database. Restore the original MT5 evidence with authorized provider-level recovery before importing workspace data. No data was changed.');
  }
  return brokerRows.length;
}
