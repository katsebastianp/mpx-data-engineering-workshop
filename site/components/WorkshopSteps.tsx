"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, ExternalLink, GitBranch, GitMerge, Terminal, Circle, CheckCircle2, Layers } from "lucide-react";
import { ChapterIntro, CopyButton, Prompt } from "./WorkshopApp";
import { workshopParts } from "./workshop-content";
import type { useParticipantProgress } from "./useParticipantProgress";
import { ParticipantAccountPanel } from "./ParticipantAccount";
import { WorktreeJourney } from "./WorktreeJourney";
import { personaliseWorkshopText } from "../lib/participant";

const exercises = workshopParts.flatMap(part => part.exercises);
const exerciseIds = new Set(exercises.map(exercise => exercise.id));
const placeLabels = {local:"Local checkout",pipeline:"Worktree A · pipeline",models:"Worktree B · models",integration:"Your final branch"};

function repositoryUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const path = url.pathname.replace(/\/$/, "");
    if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||!/^\/[A-Za-z0-9_.~-]+\/[A-Za-z0-9_.~-]+$/.test(path)) return null;
    url.pathname=path;
    return url.toString();
  } catch {return null;}
}

function Commands({children,title="Show terminal commands"}:{children:string;title?:string}) {
  return <details className="prompt commands-disclosure"><summary><span><Terminal size={15}/> {title}</span><ChevronDown size={16}/></summary><div className="prompt-content code-block"><CopyButton text={children}/><pre><code>{children}</code></pre></div></details>;
}

export function WorkshopSteps({participant}:{participant:ReturnType<typeof useParticipantProgress>}) {
  const completed=participant.status==="authenticated"?participant.completed:[];
  const repository=participant.status==="authenticated"?participant.repository:"";
  const workspace=participant.status==="authenticated"?participant.workspace:null;
  const canSave=participant.status==="authenticated"&&!participant.saving;
  const [selectedId,setSelectedId]=useState("project");
  const [repositoryDraft,setRepositoryDraft]=useState("");
  const [repositoryError,setRepositoryError]=useState("");
  const [repositoryNotice,setRepositoryNotice]=useState("");
  const panel=useRef<HTMLElement>(null);
  const selectedTemplate=exercises.find(exercise=>exercise.id===selectedId)??exercises[0];
  const previews:Record<string,string>={branch:"your-name",integrationBranch:"your-name",pipelineBranch:"your-name-pipeline_optimization",modelsBranch:"your-name-predictive_models",participantId:"your participant ID",composePrefix:"your-compose-project",repositoryUrl:"the facilitator’s repository URL"};
  const personalise=(value:string)=>workspace?personaliseWorkshopText(value,workspace,repository||null):value.replace(/\{\{([a-zA-Z]+)\}\}/g,(_,key:string)=>previews[key]||"available after sign-in");
  const selected={...selectedTemplate,
    instruction: personalise(selectedTemplate.instruction),
    hint: personalise(selectedTemplate.hint),
    checkpoint: personalise(selectedTemplate.checkpoint),
    prompt:workspace?personalise(selectedTemplate.prompt):"",
    extraPrompts:workspace?selectedTemplate.extraPrompts?.map(item=>({...item,prompt:personalise(item.prompt)})):undefined,
    commands:workspace&&selectedTemplate.commands?personalise(selectedTemplate.commands):undefined,
  };
  const part=workshopParts.find(group=>group.exercises.some(exercise=>exercise.id===selected.id))!;
  const done=completed.includes(selected.id);
  const prerequisites=selected.dependsOn.map(id=>exercises.find(exercise=>exercise.id===id)!).filter(Boolean);
  const remainingPrerequisites=prerequisites.filter(exercise=>!completed.includes(exercise.id));
  const nextSteps=exercises.filter(exercise=>exercise.dependsOn.includes(selected.id));
  const readySteps=exercises.filter(exercise=>!completed.includes(exercise.id)&&exercise.dependsOn.every(id=>completed.includes(id)));
  const total=exercises.length;

  useEffect(()=>{setRepositoryDraft(repository)},[repository]);

  useEffect(()=>{
    const readStep=()=>{const id=new URLSearchParams(window.location.search).get("step");setSelectedId(id&&exerciseIds.has(id)?id:"project")};
    readStep();
    window.addEventListener("popstate",readStep);
    return()=>window.removeEventListener("popstate",readStep);
  },[]);

  function selectStep(id:string){
    setSelectedId(id);
    const url=new URL(window.location.href);url.searchParams.set("step",id);history.replaceState({},"",url.pathname+url.search);
    if(window.matchMedia("(max-width: 980px)").matches)requestAnimationFrame(()=>panel.current?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth",block:"start"}));
  }

  async function toggleComplete(){
    if(canSave)await participant.setStepComplete(selected.id,!done);
  }

  async function saveRepository(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setRepositoryNotice("");const cleaned=repositoryUrl(repositoryDraft);
    if(!cleaned){setRepositoryError("Use an HTTPS repository URL such as https://github.com/owner/repository, without credentials");return}
    setRepositoryError("");
    if(await participant.saveRepository(cleaned))setRepositoryNotice("Saved to your account — verify access in Codex before cloning");
  }

  return <div className="workshop-tree-page">
    <ChapterIntro number="03" eyebrow="WORKSHOP INSTRUCTIONS" title="Workshop worktrees" description="Three chats: setup and integration, pipeline, and models. Develop in parallel, review both branches, then combine the results"/>
    <ParticipantAccountPanel participant={participant}/>
    {workspace&&<section className="personal-workspace section-wrap" aria-label="Your workshop branches"><div><span className="section-kicker">YOUR BRANCHES</span><p>Both worktrees start from your branch and merge back into it</p></div><dl>{[["Your final branch",workspace.branch],["Pipeline worktree",workspace.pipelineBranch],["Model worktree",workspace.modelsBranch]].map(([label,value])=><div key={label}><dt>{label}</dt><dd><code>{value}</code><CopyButton text={value}/></dd></div>)}</dl><p className="muted-note">Your prompts and commands use these names automatically · Codex verifies GitHub access and creates the branches</p></section>}
    <section className="worktree-overview section-wrap" aria-label="How to follow this workshop">
      <details className="worktree-howto"><summary><span><Layers size={16}/> How to start the two worktrees in Codex</span><ChevronDown size={16}/></summary><div className="parallel-note"><strong>Two chats can work at the same time</strong><p>Keep the original chat for setup and integration. Worktree A owns preprocessing; Worktree B owns a small model experiment matrix. You coordinate one heavy job at a time; chats can code, review or analyse in parallel.</p></div><ol><li>Create your personal branch, explore the code, and run the baseline steps below</li><li>Open a new Codex chat in the project and choose <strong>Worktree</strong> under the composer</li><li>Select your personal branch at its frozen baseline, paste its lane prompt below, then repeat for the second chat</li><li>Use <strong>Create branch here</strong> to name the two branches, or ask Codex to create distinct branches</li><li>Run /review in each worktree and let Codex create both PRs into your personal branch; approve and merge them at integration</li></ol><p>Each step supplies its own prompt. An optional read-only analysis chat can inspect saved model results; separate worktrees per model are unnecessary for this small experiment matrix.</p><a href="https://learn.chatgpt.com/docs/environments/git-worktrees" target="_blank" rel="noreferrer">Codex worktree guide <ExternalLink size={12}/></a><a href="https://learn.chatgpt.com/docs/developer-commands#ask-for-a-working-tree-review-with-review" target="_blank" rel="noreferrer">Codex /review guide <ExternalLink size={12}/></a></details>
    </section>

    <div className="worktree-progress-bar section-wrap">
      <div><span className="section-kicker">YOUR CHECKLIST</span><strong>{completed.length}<span> / {total}</span></strong><span> steps complete</span></div>
      <div className="worktree-total-progress" role="progressbar" aria-label="Completed workshop steps" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed.length}><span style={{width:`${completed.length/total*100}%`}}/></div>
      <p aria-live="polite">{participant.saving?"Saving to your account…":participant.status==="authenticated"?"Saved to your account · marked by you, not synced with Codex":participant.status==="loading"?"Loading your progress…":"Sign in to save your personal progress"}</p>
    </div>

    <div className="worktree-workspace section-wrap">
      <div id="worktree-journey" className="worktree-map-column"><WorktreeJourney completed={completed} selectedId={selected.id} onSelect={selectStep}/></div>
      <aside id="workshop-step-details" ref={panel} className={`step-detail-panel lane-${selected.location}`} aria-labelledby="selected-step-title" tabIndex={-1}>
        <div className="step-detail-meta"><span>{placeLabels[selected.location]}</span><span>{part.time}</span></div>
        <div className="step-detail-title"><h2 id="selected-step-title">{selected.title}</h2><span className={`step-status ${done?"complete":remainingPrerequisites.length?"upcoming":"ready"}`}>{done?<CheckCircle2 size={13}/>:<Circle size={12}/>} {done?"Complete":remainingPrerequisites.length?"Upcoming":"Ready"}</span></div>
        <p className="step-instruction">{selected.instruction}</p>
        {prerequisites.length>0&&<div className="step-prerequisites"><span>{remainingPrerequisites.length?"BEFORE THIS STEP":"PREREQUISITES COMPLETE"}</span><div>{prerequisites.map(exercise=><button key={exercise.id} onClick={()=>selectStep(exercise.id)}>{completed.includes(exercise.id)?<Check size={12}/>:<Circle size={10}/>} {exercise.title}</button>)}</div></div>}
        {selected.id==="project"&&<div className="repo-config"><form onSubmit={saveRepository}><label htmlFor="workshop-repository">Workshop repository</label><p id="repository-description">{repository?"Your facilitator’s link, saved to your account":"Use the repository URL supplied by your facilitator"}</p><div className="repo-input-row"><input id="workshop-repository" type="url" autoComplete="off" spellCheck={false} placeholder="https://github.com/owner/repository" value={repositoryDraft} onChange={event=>{setRepositoryDraft(event.target.value);setRepositoryError("");setRepositoryNotice("")}} aria-describedby="repository-description" aria-invalid={!!repositoryError} disabled={!canSave} required/><button className="button button-secondary" type="submit" disabled={!canSave}>Save link</button></div>{repositoryError&&<p className="repo-status is-error" role="alert">{repositoryError}</p>}{repositoryNotice&&<p className="repo-status" role="status">{repositoryNotice}</p>}</form>{repository&&<><a href={repository} className="text-link" target="_blank" rel="noreferrer">Open repository <ExternalLink size={12}/></a><Commands>{`git clone ${repository}`}</Commands></>}</div>}
        <details className="exercise-hint" key={`${selected.id}-hint`}><summary><span>Reveal a hint</span><ChevronDown size={14}/></summary><p>{selected.hint}</p></details>
        <div key={`${selected.id}-${workspace?.id??"signed-out"}-prompt`}>{workspace?<><Prompt>{selected.prompt}</Prompt>{selected.extraPrompts?.map(item=><Prompt key={item.title} title={item.title}>{item.prompt}</Prompt>)}{selected.commands&&<Commands title={selected.commandTitle}>{selected.commands}</Commands>}</>:<div className="personal-prompt-notice"><GitBranch size={18}/><div><strong>{participant.status==="loading"?"Preparing your prompts":"Sign in for your prompts and commands"}</strong><p>{participant.status==="loading"?"Your branch names will appear once your account is loaded":"Your account gives you personal branch names and a result on the leaderboard"}</p>{participant.status==="anonymous"&&<a href={participant.signInUrl||"/signin-with-chatgpt?return_to=/workshop"} target="_top" className="text-link">Sign in with ChatGPT <ArrowUpRight size={13}/></a>}</div></div>}</div>
        <div className="checkpoint"><Check size={16}/><div><span>CHECKPOINT</span><p>{selected.checkpoint}</p></div></div>
        <button className={`complete-step-button${done?" is-complete":""}`} onClick={toggleComplete} aria-pressed={done} disabled={!canSave}>{done?<CheckCircle2 size={17}/>:<Circle size={17}/>} {participant.saving?"Saving…":participant.status!=="authenticated"?"Sign in to track this step":done?"Marked complete — undo":"Mark this step complete"}</button>
        {participant.status==="anonymous"&&<a href={participant.signInUrl||"/signin-with-chatgpt?return_to=/workshop"} target="_top" className="step-signin-link">Sign in with ChatGPT <ArrowUpRight size={13}/></a>}
        {participant.error&&<p role="alert" className="step-save-error">{participant.error}</p>}
        {remainingPrerequisites.length>0&&!done&&<p className="step-advisory">You can read any step now; follow the connecting lines when carrying out the work</p>}
        {nextSteps.length>0&&<div className="step-next"><span>{nextSteps.length>1?"CONTINUE IN PARALLEL":"NEXT STEP"}</span>{nextSteps.map(exercise=><button key={exercise.id} onClick={()=>selectStep(exercise.id)}><span>{exercise.title}<small>{placeLabels[exercise.location]}</small></span><ArrowRight size={16}/></button>)}</div>}
        {selected.id==="upload"&&<a href="/leaderboard" className="workshop-next">Open the leaderboard <ArrowUpRight size={15}/></a>}
        <a className="back-to-tree" href="#worktree-journey">Back to the tree ↑</a>
      </aside>
    </div>
    <section className="worktree-bottom section-wrap"><div><span className="section-kicker">READY TO CONTINUE</span><h2>{completed.length===total?"All workshop steps complete":readySteps.length>1?"Choose your next branch":"Your next step"}</h2></div><div>{readySteps.length?readySteps.map(exercise=><button key={exercise.id} onClick={()=>{selectStep(exercise.id);if(!window.matchMedia("(max-width: 980px)").matches)document.getElementById("worktree-journey")?.scrollIntoView({behavior:"smooth",block:"start"})}}>{exercise.title}<ArrowUpRight size={15}/></button>):<a href="/leaderboard">View participant results <ArrowUpRight size={15}/></a>}</div></section>
  </div>;
}
