import Decimal from 'decimal.js-light';
type SummaryRow = {account_id:string|null; currency:string; origin:string; digits:number; amount:string; trades:number};

/** Group by decimal scale so each bucket can be accumulated as integer minor units. */
export async function accountSummaries(db:D1Database, owner:unknown) {
  const rows=await db.prepare(`WITH posted AS (
    SELECT json_extract(t.payload,'$.account_id') AS account_id,
      COALESCE(json_extract(t.payload,'$.settlement_currency'),json_extract(t.payload,'$.calculation_snapshot.account_currency'),json_extract(a.payload,'$.base_currency'),'Unknown') AS currency,
      COALESCE(json_extract(t.payload,'$.trade_source'),'manual') AS origin,
      CAST(COALESCE(json_extract(t.payload,'$.pnl_decimal'),json_extract(t.payload,'$.pnl'),0) AS TEXT) AS amount
    FROM workspace_records t LEFT JOIN workspace_records a
      ON a.id=json_extract(t.payload,'$.account_id') AND a.user_id=t.user_id AND a.table_name='trading_accounts'
    WHERE t.user_id=? AND t.table_name='trades' AND json_extract(t.payload,'$.status')='closed'
  ), scaled AS (
    SELECT *, CASE WHEN instr(amount,'.')=0 THEN 0 ELSE length(amount)-instr(amount,'.') END AS digits FROM posted
  )
  SELECT account_id,currency,origin,digits,CAST(SUM(CAST(REPLACE(amount,'.','') AS INTEGER)) AS TEXT) AS amount, COUNT(*) AS trades
  FROM scaled WHERE instr(lower(amount),'e')=0 GROUP BY account_id,currency,origin,digits`).bind(owner).all<SummaryRow>();
  const totals=new Map<string,{account_id:string|null;currency:string;origin:string;profit:string;trades:number}>();
  for(const row of rows.results){
    const key=JSON.stringify([row.account_id,row.currency,row.origin]);
    const item=totals.get(key) ?? {account_id:row.account_id,currency:row.currency,origin:row.origin,profit:'0',trades:0};
    item.profit=new Decimal(item.profit).plus(new Decimal(row.amount).div(new Decimal(10).pow(row.digits))).toString();
    item.trades+=row.trades; totals.set(key,item);
  }
  // Legacy scientific notation cannot be safely cast to SQLite integer text.
  const tiny=await db.prepare(`SELECT t.payload,a.payload AS account FROM workspace_records t LEFT JOIN workspace_records a ON a.user_id=t.user_id AND a.table_name='trading_accounts' AND a.id=json_extract(t.payload,'$.account_id')
    WHERE t.user_id=? AND t.table_name='trades' AND json_extract(t.payload,'$.status')='closed' AND instr(lower(CAST(COALESCE(json_extract(t.payload,'$.pnl_decimal'),json_extract(t.payload,'$.pnl')) AS TEXT)),'e')>0`).bind(owner).all<{payload:string;account:string|null}>();
  for(const row of tiny.results){
    const t=JSON.parse(row.payload), account_id=t.account_id ?? null, currency=t.settlement_currency||t.calculation_snapshot?.account_currency||(row.account && JSON.parse(row.account).base_currency)||'Unknown', origin=t.trade_source||'manual';
    const key=JSON.stringify([account_id,currency,origin]);
    const item=totals.get(key) ?? {account_id,currency,origin,profit:'0',trades:0};
    item.profit=new Decimal(item.profit).plus(t.pnl_decimal ?? t.pnl).toString();item.trades++;totals.set(key,item);
  }
  return [...totals.values()];
}
