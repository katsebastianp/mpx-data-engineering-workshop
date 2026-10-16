"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, LogIn, LogOut, RefreshCw, UserRound } from "lucide-react";
import type { useParticipantProgress } from "./useParticipantProgress";

type Props={participant:ReturnType<typeof useParticipantProgress>};
const defaultSignIn="/signin-with-chatgpt?return_to=/workshop";

export function ParticipantAccountMenu({participant:p}:Props){
  if(p.status==="loading")return <span className="account-loading"><UserRound size={14}/> Loading account</span>;
  if(p.status==="error")return <button className="account-header-button" onClick={()=>p.refresh()}><RefreshCw size={13}/> Retry account</button>;
  if(p.status==="anonymous"||!p.account)return <a className="account-header-button" href={p.signInUrl||defaultSignIn} target="_top"><LogIn size={14}/> Sign in</a>;
  return <details className="account-menu"><summary><UserRound size={14}/><span>My account</span><ChevronDown size={12}/></summary><div className="account-menu-content"><span className="account-eyebrow">SIGNED IN WITH CHATGPT</span><strong>{p.account.displayName}</strong><span>{p.account.email}</span><p>Your checklist is personal<br/>Your result is shared on the leaderboard</p><a href={p.signOutUrl||"/signout-with-chatgpt?return_to=/workshop"} target="_top"><LogOut size={13}/> Sign out</a></div></details>;
}

export function ParticipantAccountPanel({participant:p}:Props){
  const [runName, setRunName] = useState("");
  useEffect(() => { setRunName(p.workspace?.runName ?? ""); }, [p.workspace?.runName]);
  const legacy=!p.workspace?.runName&&p.status==="authenticated"&&p.legacy&&(p.legacy.completed.some(id=>!p.completed.includes(id))||(!p.repository&&!!p.legacy.repository))?p.legacy:null;
  return <section className="participant-panel-wrap section-wrap" aria-label="Participant account">
    {p.status!=="authenticated"&&<div className={`participant-panel ${p.status}`}>
      <span className="participant-avatar"><UserRound size={20}/></span>
      <div className="participant-account-copy">
        <strong>{p.status==="loading"?"Loading your account":p.status==="anonymous"?"Sign in to track your workshop":"Your account could not be loaded"}</strong>
        <p>{p.status==="anonymous"?"Use your ChatGPT account for personalised prompts, saved progress, and your own result":p.status==="loading"?"Checking sign-in and saved progress":"Retry to load your progress before making changes"}</p>
      </div>
      {p.status==="anonymous"&&<a className="primary-button" href={p.signInUrl||defaultSignIn} target="_top">Sign in with ChatGPT <ArrowUpRight size={14}/></a>}
      {p.status==="error"&&<button className="secondary-button" onClick={()=>p.refresh()}>Retry <RefreshCw size={13}/></button>}
    </div>}
    {p.status==="authenticated"&&<form className="workshop-run-form" onSubmit={async event=>{event.preventDefault(); await p.useRun(runName.trim());}}>
      <label htmlFor="workshop-run-name">Run name</label>
      <div className="workshop-run-controls">
        <input id="workshop-run-name" value={runName} onChange={event=>setRunName(event.target.value)} placeholder="leon-test1" list="workshop-saved-runs" pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" maxLength={48} required disabled={p.saving} autoComplete="off" spellCheck={false}/>
        <datalist id="workshop-saved-runs">{p.availableRuns.map(name=><option key={name} value={name}/>)}</datalist>
        <button className="secondary-button" disabled={p.saving||runName===p.workspace?.runName}>Use name</button>
        {p.workspace?.runName&&<button className="text-link" type="button" disabled={p.saving} onClick={()=>p.useRun(null)}>Original run</button>}
      </div>
      <p>New name, new branches and checklist. Use a saved name to resume.</p>
    </form>}
    {p.error&&<div className="participant-error" role="alert"><span>{p.error}</span><button onClick={()=>p.refresh()} disabled={p.saving}>Reload progress</button></div>}
    {legacy&&<div className="legacy-progress"><div><strong>Bring over this browser’s checklist</strong><p>Found {legacy.completed.length} saved checklist step{legacy.completed.length===1?"":"s"}{legacy.repository?" and a repository link":""} from the earlier version. Importing adds them to this account’s progress</p></div><div><button onClick={()=>p.importLegacy()} disabled={p.saving}>Import browser progress</button><button onClick={()=>p.dismissLegacy()} disabled={p.saving}>Keep account progress</button></div></div>}
  </section>;
}
