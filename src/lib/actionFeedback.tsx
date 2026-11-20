import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ActionTone = 'success' | 'error' | 'info' | 'warning';
type ActionMessage = { id:number; tone:ActionTone; message:string; createdAt:number };

let sequence = 0;
/** Notify only after an operation's promise resolves/rejects.
 * A button click on its own is not evidence that a network request succeeded. */
export function announceAction(tone: ActionTone, message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ActionMessage>('ym:action-result', {
      detail: { id: ++sequence, tone, message, createdAt:Date.now() },
    }));
  }
}

export function ActionFeedbackHost() {
  const [messages,setMessages]=useState<ActionMessage[]>([]);
  useEffect(()=>{
    const onResult=(event:Event)=>{
      const item=(event as CustomEvent<ActionMessage>).detail;
      if(!item?.message) return;
      setMessages(previous=>{
        const last=previous.at(-1);
        // A domain-level confirmation may follow a generic mutation status.
        // Present the more recent result instead of stacking near-duplicates.
        if(last && last.tone===item.tone && item.createdAt-last.createdAt<1000)
          return [...previous.slice(0,-1),item].slice(-3);
        return [...previous.filter(x=>x.id!==item.id),item].slice(-3);
      });
    };
    window.addEventListener('ym:action-result',onResult);
    return()=>window.removeEventListener('ym:action-result',onResult);
  },[]);
  useEffect(()=>{
    const timers=messages.filter(item=>item.tone!=='error').map(item=>
      window.setTimeout(()=>setMessages(current=>current.filter(x=>x.id!==item.id)),
        item.tone==='warning'?9000:5800));
    return()=>timers.forEach(timer=>window.clearTimeout(timer));
  },[messages]);
  return <div className="ym-feedback-stack" aria-label="Operation notifications">
    {messages.map(item=><div key={item.id} className="ym-feedback-toast" data-tone={item.tone}
      role={item.tone==='error'?'alert':'status'}>
      <span className="ym-feedback-toast-icon">{item.tone==='success'?<CheckCircle2 size={18}/>:item.tone==='error'||item.tone==='warning'?<AlertTriangle size={18}/>:<Info size={18}/>}</span>
      <p>{item.message}</p>
      <button type="button" aria-label="Dismiss notification" onClick={()=>setMessages(previous=>previous.filter(x=>x.id!==item.id))}><X size={17}/></button>
    </div>)}
  </div>;
}
