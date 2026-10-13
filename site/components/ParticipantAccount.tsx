"use client";

import { ArrowUpRight, Check, ChevronDown, LogIn, LogOut, RefreshCw, UserRound } from "lucide-react";
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
  const legacy=p.status==="authenticated"&&p.legacy&&(p.legacy.completed.some(id=>!p.completed.includes(id))||(!p.repository&&!!p.legacy.repository))?p.legacy:null;
  return <section className="participant-panel-wrap section-wrap" aria-label="Participant account">
    <div className={`participant-panel ${p.status}`}>
      <span className="participant-avatar"><UserRound size={20}/></span>
      <div className="participant-account-copy">
        <strong>{p.status==="loading"?"Loading your account":p.status==="authenticated"&&p.account?`Signed in as ${p.account.displayName}`:p.status==="anonymous"?"Sign in to track your workshop":"Your account could not be loaded"}</strong>
        <p>{p.status==="authenticated"?"Your checklist is saved privately to your account and available when you sign in on another device":p.status==="anonymous"?"Use your ChatGPT account for personalised prompts, saved progress, and your own result":p.status==="loading"?"Checking sign-in and saved progress":"Retry to load your progress before making changes"}</p>
      </div>
      {p.status==="anonymous"&&<a className="primary-button" href={p.signInUrl||defaultSignIn} target="_top">Sign in with ChatGPT <ArrowUpRight size={14}/></a>}
      {p.status==="authenticated"&&<div className="participant-save-state" aria-live="polite">{p.saving?<><RefreshCw size={13} className="spinning"/> Saving…</>:p.error?<span>Save needs attention</span>:<><Check size={14}/> {p.saveNotice||"Account sync on"}</>}</div>}
      {p.status==="error"&&<button className="secondary-button" onClick={()=>p.refresh()}>Retry <RefreshCw size={13}/></button>}
    </div>
    {p.error&&<div className="participant-error" role="alert"><span>{p.error}</span><button onClick={()=>p.refresh()} disabled={p.saving}>Reload progress</button></div>}
    {legacy&&<div className="legacy-progress"><div><strong>Bring over this browser’s checklist</strong><p>Found {legacy.completed.length} saved checklist step{legacy.completed.length===1?"":"s"}{legacy.repository?" and a repository link":""} from the earlier version. Importing adds them to this account’s progress</p></div><div><button onClick={()=>p.importLegacy()} disabled={p.saving}>Import browser progress</button><button onClick={()=>p.dismissLegacy()} disabled={p.saving}>Keep account progress</button></div></div>}
    <p className="participant-sharing-note">Your prompts, branches, checklist, and submission are personal · Checklist completion is manual</p>
  </section>;
}
