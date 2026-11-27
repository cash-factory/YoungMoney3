import {useEffect,useState} from 'react';
import {CheckCircle2,LoaderCircle,AlertCircle,AtSign} from 'lucide-react';
import {normalizeUsername,validUsername} from '@/lib/username';

type CheckResult = {available?:boolean;username?:string;suggestions?:string[];error?:string};
type State = {status:'idle'|'invalid'|'checking'|'available'|'taken'|'error';suggestions:string[];message:string};
interface UsernameFieldProps {
  value:string;
  onChange:(value:string)=>void;
  id:string;
  label?:string;
}
export function UsernameField({value,onChange,id,label='Username'}:UsernameFieldProps){
  const normalized=normalizeUsername(value);
  const [result,setResult]=useState<State>({status:'idle',suggestions:[],message:''});
  useEffect(()=>{
    if(!normalized){setResult({status:'idle',message:'',suggestions:[]});return;}
    if(!validUsername(normalized)){
      setResult({status:'invalid',message:'Use 3–32 lowercase letters, numbers or underscores.',suggestions:[]});
      return;
    }
    const controller=new AbortController();
    setResult({status:'checking',message:'Checking availability…',suggestions:[]});
    const handle=window.setTimeout(async()=>{
      try{
        const response=await fetch('/api/auth/username-availability',{
          method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},
          body:JSON.stringify({username:normalized}),signal:controller.signal,
        });
        const data=await response.json() as CheckResult;
        if(controller.signal.aborted)return;
        if(!response.ok){
          setResult({status:'error',message:data.error||'Availability is temporarily unavailable. The server will verify on save.',suggestions:[]});
          return;
        }
        setResult({status:data.available?'available':'taken',suggestions:data.suggestions||[],
          message:data.available?'Available at last check — final confirmation happens on save.':'This username is already taken.'});
      }catch{
        if(!controller.signal.aborted)setResult({status:'error',message:'Could not check availability. Final confirmation happens when saving.',suggestions:[]});
      }
    },380);
    return()=>{window.clearTimeout(handle);controller.abort();};
  },[normalized]);
  return <div className="ym-username-field">
    <label htmlFor={id} className="block text-xs font-semibold text-secondary mb-1.5">{label}</label>
    <div className="ym-username-input">
      <AtSign size={16} aria-hidden="true"/>
      <input id={id} className="input-field" value={value} onChange={event=>onChange(event.target.value)}
        autoComplete="username" spellCheck={false} maxLength={32} required placeholder="your_unique_username"
        aria-describedby={id+'-feedback'} />
    </div>
    <p className="ym-username-result" data-status={result.status} id={id+'-feedback'} aria-live="polite" role="status">
      {result.status==='checking'?<LoaderCircle size={14} className="animate-spin" aria-hidden="true"/>:result.status==='available'?<CheckCircle2 size={14} aria-hidden="true"/>:
        result.status==='taken'||result.status==='invalid'?<AlertCircle size={14} aria-hidden="true"/>:null}
      {result.message||'Your username appears on Signal Desk and can be changed here later.'}
    </p>
    {result.status==='taken'&&result.suggestions.length>0&&
      <div className="ym-username-suggestions" aria-label="Available alternative usernames">
        <span>Try an available alternative:</span>
        {result.suggestions.map(name=><button type="button" key={name} onClick={()=>onChange(name)}>@{name}</button>)}
      </div>}
  </div>;
}
