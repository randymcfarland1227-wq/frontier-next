'use client';

import { useState, type ReactNode } from 'react';
import { Dialog } from '../sticker/Dialog';
import { Icon } from '../sticker/Icon';
import { useRowMenu } from './RowMenu';
import { cashDraws, cashProviderKey, cashProviders, logCashAdvance, type CashProvider } from '../../lib/cashAdvances';
import { findingDueKey, findingPaymentDues, removeFinding, setFinding, useFindings } from '../../lib/finFindings';
import { applyBillEdits, useBillEdits } from '../../lib/billEdits';
import { openBillPop, requestPayBill } from '../../lib/finLinks';
import { useMoneyMeta } from '../../lib/moneyMeta';
import { localDayKey } from '../../lib/dayKey';
import { money } from '../../lib/schedule';

export type LegacyCashAdvance = { key: string; name: string; amount?: number; due?: string; done?: boolean; unverified?: boolean };
const date = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'});

export function CashAdvanceAccounts({paidAt, legacy = [], renderLegacy}: {
  paidAt: Record<string,string>; legacy?: LegacyCashAdvance[]; renderLegacy?: (keys: string[]) => ReactNode;
}) {
  const store=useFindings();
  const edits=useBillEdits();
  const {get:paidMeta}=useMoneyMeta();
  const providers=cashProviders(store,legacy.map(l=>l.name));
  const [selected,setSelected]=useState<string|null>(null);
  const [logging,setLogging]=useState(false);
  const [source,setSource]=useState('Dave');
  const [newSource,setNewSource]=useState('');
  const [received,setReceived]=useState('');
  const [repay,setRepay]=useState('');
  const [takenOn,setTakenOn]=useState(localDayKey);
  const [due,setDue]=useState('');
  const [error,setError]=useState('');
  const [showRemoved,setShowRemoved]=useState(false);
  const dues=applyBillEdits(findingPaymentDues(store,new Set(),new Date(),365000,365000,true),edits);
  const rows=(p:CashProvider)=>cashDraws(store,p.key).flatMap(draw=>{
    const payment=draw.payments?.[0];
    const d=payment && dues.find(d=>d.key===findingDueKey(payment));
    if (!d) return [];
    const paid=paidAt[d.key];
    const receipt=paid && paidMeta(`paid:${d.key}`);
    const shown=receipt ? {...d,due:receipt.paidDue || d.due,bill:{...d.bill,amount:receipt.amount ?? d.bill.amount}} : d;
    return [{draw,d:shown,paid}];
  }).sort((a,b)=>a.d.due.localeCompare(b.d.due));
  const oldRows=(p:CashProvider)=>legacy.filter(l=>cashProviderKey(l.name)===p.key);
  const outstanding=(p:CashProvider)=>rows(p).filter(r=>!r.paid);
  const balance=(p:CashProvider)=>outstanding(p).reduce((n,r)=>n+(r.d.bill.amount||0),0)+oldRows(p).filter(r=>!r.done&&!r.unverified).reduce((n,r)=>n+(r.amount||0),0);
  const hasOpen=(p:CashProvider)=>outstanding(p).length>0||oldRows(p).some(l=>!l.done);
  const unknown=(p:CashProvider)=>oldRows(p).some(l=>!l.done&&(l.amount===undefined||l.unverified));
  const next=(p:CashProvider)=>[...outstanding(p).map(r=>r.d.due),...oldRows(p).filter(l=>!l.done&&l.due).map(l=>l.due!)].sort()[0];
  const account=providers.find(p=>p.key===selected);
  const begin=(name?:string)=>{setSource(name||providers.find(p=>!p.removed)?.name||'__new');setNewSource('');setReceived('');setRepay('');setDue('');setTakenOn(localDayKey());setError('');setSelected(null);setLogging(true);};
  const tools=useRowMenu(()=>account ? [{label:account.removed?'Restore source':'Remove source',onSelect:()=>{
    if(account.removed)setFinding(account.key,{name:account.name});
    else {setFinding(account.key,{name:account.name});removeFinding(account.key);}
    setSelected(null);
  }}] : [], account?.name||'Advance source');
  const drawRow=(r:ReturnType<typeof rows>[number])=><li key={r.draw.key} className={r.paid?'is-paid':''}>
    <div><b>{money(r.d.bill.amount||0)} repayment</b><span>Received {money(r.draw.cashAdvance!.received)} · {date(r.draw.cashAdvance!.takenOn)}</span><span>Due {date(r.d.due)}{r.paid?` · Paid ${new Date(r.paid).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'})}`:''}</span></div>
    {r.paid?<span className="mb-ca-paid">Paid</span>:<div className="mb-ca-actions"><button type="button" className="sk-link" onClick={()=>openBillPop(r.d.key)}>Details</button><button type="button" className="sk-btn is-small" onClick={()=>requestPayBill(r.d.key)}>Mark paid</button></div>}
  </li>;
  return <section className="sk-group tone-card skm-sec ob-col mb-ca" aria-label="Cash advance accounts">
    <header className="sk-ghead skm-head"><div className="skm-titles"><h2 className="sk-hl">Cash advances</h2><button type="button" className="sk-btn is-small" onClick={()=>begin()}>+ Log an advance</button></div><div className="skm-fig"><b>{money(providers.reduce((n,p)=>n+balance(p),0))}</b><small>to repay</small></div></header>
    <div className="sk-gbody skm-body"><ul className="mb-ca-accounts">{providers.filter(p=>!p.removed||hasOpen(p)).map(p=><li key={p.key}><button type="button" onClick={()=>setSelected(p.key)}><b>{p.name}</b><span>{hasOpen(p)?(next(p)?`Next ${date(next(p)!)}`:'Repayment date not set'):'No upcoming payment due'}</span><strong>{money(balance(p))}{unknown(p)?" + ?":""}</strong><Icon name="chevron" size={13}/></button></li>)}</ul>
      {providers.some(p=>p.removed&&!hasOpen(p))?<><button type="button" className="sk-link" onClick={()=>setShowRemoved(!showRemoved)}>{showRemoved?'Hide':'Show'} removed sources</button>{showRemoved?providers.filter(p=>p.removed&&!hasOpen(p)).map(p=><button type="button" className="sk-link" key={p.key} onClick={()=>setSelected(p.key)}>{p.name} · history</button>):null}</>:null}
    </div>
    {logging?<Dialog label="Log an advance" onClose={()=>setLogging(false)} className="mb-ca-dialog"><header className="mb-ca-head"><h2>Log an advance</h2><button type="button" className="sk-btn is-small is-icon" aria-label="Close advance form" onClick={()=>setLogging(false)}><Icon name="close" size={16}/></button></header>
      <form className="mb-ca-form" onSubmit={e=>{e.preventDefault();try{logCashAdvance({provider:source==='__new'?newSource:source,received:Number(received),repay:Number(repay),due,takenOn});setLogging(false);}catch(err){setError(err instanceof Error?err.message:'Could not save the advance.');}}}>
        <label className="mb-ca-wide">Source<select autoFocus value={source} onChange={e=>setSource(e.target.value)}>{providers.filter(p=>!p.removed).map(p=><option key={p.key} value={p.name}>{p.name}</option>)}<option value="__new">+ New source…</option></select></label>
        {source==='__new'?<label className="mb-ca-wide">New source name<input required maxLength={100} value={newSource} onChange={e=>setNewSource(e.target.value)} placeholder="e.g. Rocco"/></label>:null}
        <label>Advance received<input type="number" inputMode="decimal" min="0.01" step="0.01" required value={received} onChange={e=>{if(!repay||repay===received)setRepay(e.target.value);setReceived(e.target.value);}} placeholder="45.00"/></label>
        <label>Repay amount<input type="number" inputMode="decimal" min="0.01" step="0.01" required value={repay} onChange={e=>setRepay(e.target.value)} placeholder="Including fees"/></label>
        <label>Advance date<input type="date" required value={takenOn} onChange={e=>setTakenOn(e.target.value)}/></label>
        <label>Repay date<input type="date" min={takenOn} required value={due} onChange={e=>setDue(e.target.value)}/></label>
        <p className="mb-ca-wide mb-dim">The repayment appears in To Pay. The source stays here after it is paid.</p>
        {error?<p className="mb-ca-wide mb-late" role="alert">{error}</p>:null}
        <div className="mb-ca-wide mb-ca-actions"><button type="submit" className="sk-btn is-small is-prominent">Log advance</button><button type="button" className="sk-btn is-small" onClick={()=>setLogging(false)}>Cancel</button></div>
      </form></Dialog>:null}
    {account?<Dialog label={`${account.name} advances`} onClose={()=>setSelected(null)} className="mb-ca-dialog"><header className="mb-ca-head"><div><h2>{account.name}</h2><p>{money(balance(account))} to repay</p></div><div className="mb-ca-actions"><button type="button" className="sk-btn is-small is-icon" aria-label="Source tools" onClick={e=>tools.open(e.currentTarget)}>⋯</button><button type="button" className="sk-btn is-small is-icon" aria-label="Close source" onClick={()=>setSelected(null)}><Icon name="close" size={16}/></button></div></header>
      <div className="mb-ca-detail">{account.removed?<p className="mb-dim">Removed from new-advance options. Existing repayments and history stay here.</p>:null}<div className="mb-ca-head"><h3>Upcoming repayments</h3><button type="button" className="sk-btn is-small" onClick={()=>begin(account.removed?undefined:account.name)}>+ Log an advance</button></div>{!hasOpen(account)?<p className="mb-dim">No upcoming payment due.</p>:null}<ul className="mb-ca-draws">{outstanding(account).map(drawRow)}</ul>
      {oldRows(account).some(r=>!r.done)?renderLegacy?.(oldRows(account).filter(r=>!r.done).map(r=>r.key)):null}
      <h3>Paid history</h3><ul className="mb-ca-draws">{rows(account).filter(r=>r.paid).sort((a,b)=>b.paid!.localeCompare(a.paid!)).map(drawRow)}</ul>
      {oldRows(account).some(r=>r.done)?renderLegacy?.(oldRows(account).filter(r=>r.done).map(r=>r.key)):null}
      {!rows(account).some(r=>r.paid)&&!oldRows(account).some(r=>r.done)?<p className="mb-dim">No paid advances yet.</p>:null}</div>{tools.menu}</Dialog>:null}
  </section>;
}
