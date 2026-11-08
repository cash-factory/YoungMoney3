import { accountLedger } from '@/lib/tradeFinance';
import type { Trade, TradingAccountAdjustment } from '@/lib/types';
import { useEffect, useMemo, useState } from 'react';
import { Calculator, RotateCcw, ShieldAlert, Target } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useMarketInstruments, useTradingAccounts } from '@/hooks/useData';
import { calculatePositionSize, instrumentDistanceLabel, instrumentDistanceStep, instrumentPnl } from '@/lib/instrumentMath';

export function TradeCalculator({ trades, adjustments }: { trades: Trade[]; adjustments: TradingAccountAdjustment[] }) {
  const { user } = useAuth();
  const { accounts } = useTradingAccounts(user?.id);
  const { instruments } = useMarketInstruments(user?.id);
  const [accountId, setAccountId] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [entry, setEntry] = useState('');
  const [exit, setExit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [quantity, setQuantity] = useState('');
  const [conversion, setConversion] = useState('');
  const [fees, setFees] = useState('0');

  useEffect(() => {
    if (!accountId && accounts.length) setAccountId((accounts.find(account => account.is_active) || accounts[0]).id);
  }, [accounts, accountId]);
  useEffect(() => {
    if (!instrumentId && instruments.length) {
      const preferred = instruments.find(instrument => instrument.symbol === 'EUR/USD') || instruments[0];
      setInstrumentId(preferred.id);
    }
  }, [instruments, instrumentId]);

  const account = accounts.find(item => item.id === accountId) || null;
  const instrument = instruments.find(item => item.id === instrumentId) || null;
  const balance = account ? accountLedger(account, trades, adjustments).balance : 0;
  const conversionRequired = !!account && !!instrument && instrument.quote_currency !== account.base_currency;
  const conversionRate = conversionRequired ? Number(conversion) : 1;

  const result = useMemo(() => {
    const entryPrice = Number(entry);
    const exitPrice = Number(exit);
    const stopPrice = Number(stopLoss);
    const size = Number(quantity);
    const estimatedFees = Number(fees);
    const hasPrices = Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(exitPrice) && exitPrice > 0;
    const validConversion = !conversionRequired || (Number.isFinite(conversionRate) && conversionRate > 0);
    const validInputs = !!account && !!instrument && validConversion && Number.isFinite(size) && size > 0 && Number.isFinite(estimatedFees) && estimatedFees >= 0;
    const distance = instrument ? (direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice) / instrumentDistanceStep(instrument) : 0;
    const grossPnl = hasPrices && validInputs ? instrumentPnl(instrument!, direction, entryPrice, exitPrice, size, conversionRate) : 0;
    const pnl = grossPnl - estimatedFees;
    const stopRisk = instrument && validInputs && Number.isFinite(stopPrice) && stopPrice > 0
      ? Math.abs(instrumentPnl(instrument, direction, entryPrice, stopPrice, size, conversionRate)) + estimatedFees
      : 0;
    const riskPercent = account && balance > 0 && stopRisk > 0 ? stopRisk / balance * 100 : 0;
    const suggestedSize = instrument && account && validConversion && Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(stopPrice) && stopPrice > 0
      ? calculatePositionSize(instrument, balance, account.risk_per_trade_pct, entryPrice, stopPrice, conversionRate, estimatedFees)
      : null;
    const rr = stopRisk > 0 ? pnl / stopRisk : null;

    return { distance, pnl, stopRisk, riskPercent, rr, suggestedSize, hasData: hasPrices && validInputs, validConversion };
  }, [account, balance, conversionRate, conversionRequired, direction, entry, exit, fees, instrument, quantity, stopLoss]);

  const reset = () => {
    setEntry(''); setExit(''); setStopLoss(''); setQuantity(''); setConversion(''); setFees('0');
  };

  const inputCls = 'input-field';
  const labelCls = 'block text-xs font-semibold text-secondary mb-1.5 uppercase tracking-wide';
  const formatMoney = (value: number) => new Intl.NumberFormat(undefined, {
    style: 'currency', currency: account?.base_currency || 'USD', maximumFractionDigits: 2,
  }).format(value);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-orange-500/10">
            <Calculator size={16} className="text-orange-500" />
          </div>
          Position Estimate
        </h3>
        <button onClick={reset} className="btn-ghost p-1.5 text-xs">
          <RotateCcw size={14} /> Reset
        </button>
      </div>

      {!accounts.length ? <p className="mb-4 text-xs text-amber-600">Create an account to calculate estimates in its base currency.</p> : null}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <div>
          <label className={labelCls}>Account</label>
          <select className={inputCls} value={accountId} onChange={event => { setAccountId(event.target.value); setConversion(''); }}>
            {accounts.map(item => <option key={item.id} value={item.id}>{item.name} · {item.base_currency}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Instrument</label>
          <select className={inputCls} value={instrumentId} onChange={event => { setInstrumentId(event.target.value); setConversion(''); }}>
            {instruments.map(item => <option key={item.id} value={item.id}>{item.symbol}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Direction</label>
          <select className={inputCls} value={direction} onChange={e => setDirection(e.target.value as 'long' | 'short')}>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Quantity {instrument ? `(${instrument.quantity_unit})` : ''}</label>
          <input type="number" min="0" step="any" className={inputCls} value={quantity} onChange={event => setQuantity(event.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Entry Price</label>
          <input type="number" min="0" step={instrument?.price_increment || 'any'} className={inputCls} value={entry} onChange={event => setEntry(event.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Exit Price</label>
          <input type="number" min="0" step={instrument?.price_increment || 'any'} className={inputCls} value={exit} onChange={event => setExit(event.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Stop Loss</label>
          <input type="number" min="0" step={instrument?.price_increment || 'any'} className={inputCls} value={stopLoss} onChange={event => setStopLoss(event.target.value)} />
        </div>
        {conversionRequired && <div>
          <label className={labelCls}>{instrument?.quote_currency} to {account?.base_currency} rate</label>
          <input type="number" min="0" step="any" className={inputCls} value={conversion} onChange={event => setConversion(event.target.value)} placeholder="Required" />
        </div>}
        <div>
          <label className={labelCls}>Estimated fees ({account?.base_currency || 'currency'})</label>
          <input type="number" min="0" step="any" className={inputCls} value={fees} onChange={event => setFees(event.target.value)} />
        </div>
      </div>

      {instrument?.example_price != null && <p className="mb-3 text-[11px] text-amber-600">Catalog values are illustrative, not live quotes. Verify contract terms and conversion with your broker.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Result label={instrument ? instrumentDistanceLabel(instrument) : 'Distance'} value={result.hasData && instrument ? `${result.distance.toFixed(1)} ${instrumentDistanceLabel(instrument)}` : '—'} icon={<Target size={14} />} />
        <Result label="Est. net P&L" value={result.hasData ? formatMoney(result.pnl) : '—'} icon={<Calculator size={14} />} />
        <Result label="Est. risk at stop" value={result.stopRisk > 0 ? formatMoney(result.stopRisk) : '—'} icon={<ShieldAlert size={14} />} />
        <Result label="Risk %" value={result.riskPercent > 0 ? `${result.riskPercent.toFixed(2)}%` : '—'} icon={<ShieldAlert size={14} />} />
        <Result label="Suggested size" value={result.suggestedSize != null ? String(result.suggestedSize) : '—'} icon={<Calculator size={14} />} />
      </div>

      {!result.hasData && <p className="mt-3 text-xs text-muted text-center">Select an account and instrument, then enter positive prices and quantity{conversionRequired && !result.validConversion ? ' and a valid conversion rate' : ''}.</p>}
    </div>
  );
}

function Result({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="p-3 rounded-lg bg-secondary border border-themed text-center">
    <div className="inline-flex p-1.5 rounded-md bg-orange-500/10 text-orange-500 mb-1.5">{icon}</div>
    <p className="text-[10px] font-semibold text-muted uppercase mb-0.5">{label}</p>
    <p className="text-sm font-mono font-bold">{value}</p>
  </div>;
}
