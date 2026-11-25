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
  const [pausedId,setPausedId]=useState<number|null>(null);
  const [visible,setVisible]=useState(() => typeof document === 'undefined' || !document.hidden);
  useEffect(() => {
    const updateVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);
  useEffect(()=>{
    const onResult=(event:Event)=>{
      const item=(event as CustomEvent<ActionMessage>).detail;
      if(!item?.message) return;
      setMessages(previous=>{
        const last=previous[previous.length-1];
        if(last && last.tone===item.tone && last.message===item.message && item.createdAt-last.createdAt<1000)
          return [...previous.slice(0,-1),item];
        const next=[...previous.filter(x=>x.id!==item.id),item];
        if(next.length>4) {
          // Dismiss a routine receipt before hiding a warning the trader has not read.
          const routine=next.findIndex(x=>x.tone==='success'||x.tone==='info');
          next.splice(routine>=0?routine:0,1);
        }
        return next;
      });
    };
    window.addEventListener('ym:action-result',onResult);
    return()=>window.removeEventListener('ym:action-result',onResult);
  },[]);
  useEffect(()=>{
    if(!visible) return;
    const timers=messages.filter(item=>(item.tone==='success'||item.tone==='info') && item.id!==pausedId)
      .map(item=>window.setTimeout(
        ()=>setMessages(current=>current.filter(x=>x.id!==item.id)),
        Math.max(1800,(item.tone==='success'?6500:8500)-(Date.now()-item.createdAt))
      ));
    return()=>timers.forEach(timer=>window.clearTimeout(timer));
  },[messages,pausedId,visible]);
  return <div className="ym-feedback-stack" aria-label="Operation notifications">
    {messages.map(item=><div key={item.id} className="ym-feedback-toast" data-tone={item.tone}
      role={item.tone==='error'?'alert':'status'}
      onMouseEnter={()=>setPausedId(item.id)}
      onMouseLeave={()=>setPausedId(current=>current===item.id?null:current)}
      onFocusCapture={()=>setPausedId(item.id)}
      onBlurCapture={event=>{
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setPausedId(current=>current===item.id?null:current);
      }}>
      <span className="ym-feedback-toast-icon">{item.tone==='success'?<CheckCircle2 size={18}/>:item.tone==='error'||item.tone==='warning'?<AlertTriangle size={18}/>:<Info size={18}/>}</span>
      <div className="ym-feedback-toast-body"><strong>{item.tone==='success'?'Completed':item.tone==='error'?'Action unsuccessful':item.tone==='warning'?'Needs attention':'Update'}</strong><p>{item.message}</p></div>
      <button type="button" aria-label="Dismiss notification" onClick={()=>setMessages(previous=>previous.filter(x=>x.id!==item.id))}><X size={17}/></button>
    </div>)}
  </div>;
}
