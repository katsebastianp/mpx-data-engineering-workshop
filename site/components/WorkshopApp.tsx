"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, Copy } from "lucide-react";
import PhysicsJourney from "./PhysicsJourney";
import { PredictionFlow } from "./PredictionFlow";
import { WorkshopSteps } from "./WorkshopSteps";
import { Leaderboard } from "./Leaderboard";
import { useParticipantProgress } from "./useParticipantProgress";
import { ParticipantAccountMenu } from "./ParticipantAccount";

type Page = "physics" | "brief" | "workshop" | "leaderboard";
const pages: { id: Page; title: string; href: string }[] = [{id:"physics",title:"Physics",href:"/"},{id:"brief",title:"Workshop brief",href:"/brief"},{id:"workshop",title:"Instructions",href:"/workshop"},{id:"leaderboard",title:"Leaderboard",href:"/leaderboard"}];

export function CopyButton({text}:{text:string}) {
  const [status,setStatus]=useState("");
  return <button className="copy-button" onClick={async()=>{try{await navigator.clipboard.writeText(text);setStatus("Copied");setTimeout(()=>setStatus(""),1800)}catch{setStatus("Select and copy the text")}}}>{status||<>Copy <Copy size={13}/></>}</button>;
}
export function Prompt({title="Reveal Codex prompt",children}:{title?:string;children:string}) {
  const lines = children.split("\n").filter(line => line.trim());
  const bullets = lines.length > 0 && lines.every(line => line.startsWith("- "));
  return <details className="prompt"><summary><span><span className="prompt-symbol">⌘</span>{title}</span><ChevronDown size={16}/></summary><div className="prompt-content"><CopyButton text={children}/>{bullets?<ul className="prompt-bullets">{lines.map((line,index)=><li key={index}>{line.slice(2)}</li>)}</ul>:<pre>{children}</pre>}</div></details>;
}
export function ChapterIntro({number,eyebrow,title,description}:{number:string;eyebrow:string;title:string;description:string}) {return <header className="chapter-intro"><div className="eyebrow"><span>{number} / 04</span><span>{eyebrow}</span></div><h1>{title}</h1><p>{description}</p></header>}

export default function WorkshopApp({initialPage="physics"}:{initialPage?:Page}){
 const [page,setPage]=useState<Page>(initialPage);
 const participant=useParticipantProgress();
 useEffect(()=>{const pop=()=>setPage(pages.find(p=>p.href===location.pathname)?.id||"physics");window.addEventListener("popstate",pop);return()=>window.removeEventListener("popstate",pop)},[]);
 function navigate(next:Page){setPage(next);history.pushState({},"",pages.find(p=>p.id===next)!.href);window.scrollTo({top:0,behavior:"instant"});document.title=`${pages.find(p=>p.id===next)!.title} · From particle collisions to better models`;}
 return <><a href="#content" className="skip-link">Skip to content</a><header className="site-header"><a href="/" className="wordmark" onClick={e=>{e.preventDefault();navigate("physics")}} aria-label="From particle collisions to better models home"><span className="brand-mark"><i/><i/><i/></span><span>COLLISIONS<span className="wordmark-light"> / MODELS</span></span></a><nav aria-label="Chapters">{pages.map((p,i)=><a href={p.href} aria-current={page===p.id?"page":undefined} onClick={e=>{e.preventDefault();navigate(p.id)}} key={p.id}><span>0{i+1}</span>{p.title}</a>)}</nav><ParticipantAccountMenu participant={participant}/></header><main id="content" key={page}>{page==="physics"?<Physics/>:page==="brief"?<Brief navigate={navigate}/>:page==="workshop"?<WorkshopSteps participant={participant}/>:<Leaderboard participant={participant}/>}</main><footer className="footer"><span>COLLISIONS / MODELS</span><span>Ringier × OpenAI · Codex workshop</span><span>JetClass-II simulated data · Codex workshop</span></footer></>;
}

function Physics(){
 return <PhysicsJourney/>;
}
function Brief({navigate}:{navigate:(p:Page)=>void}) {
 const requirements = [
  ['Codex', 'Use the model available in your workspace. Try a repository read before the session; the core exercises do not require Ultra.'],
  ['GitHub plugin + access', 'Connect GitHub and check that you can push a branch to the workshop repository. Terminal commands are available if the plugin cannot clone locally.'],
  ['Docker ready', 'Start Docker Desktop or Colima and build the workshop image before the session if possible. The lab uses 2 CPUs and 2 GiB; run one heavy job at a time.'],
  ['Four sample files', 'Download the four files from instruction step 02. No host Python, Java, GPU or API key is needed. The core setup skips the optional Sophon model download.'],
  ['Plan, Worktree and Code Review', 'Find Plan in the composer, try a Worktree chat, and locate Review PR or Code Review. The Site explains each control when you need it.'],
  ['Your account', 'Sign in to this Site for personal branch names and a saved checklist. Check Sites access if you want to publish your results page.'],
 ];
 return <div className="brief-page">
  <section className="section-wrap requirements"><div className="section-heading"><div><span className="section-kicker">BEFORE YOU ARRIVE</span><h1>Get setup out of the way</h1></div><p>Check access on the laptop<br/>you will bring to the workshop</p></div><div className="requirement-grid">{requirements.map((row, index) => <article key={row[0]}><span className="mono">0{index+1}</span><div><h3>{row[0]}</h3><p>{row[1]}</p></div></article>)}</div><p className="muted-note">The timings below are a facilitation target. First-time Docker builds and slower laptops can take longer. Keep max_workers at 1 and ask for help if setup stalls.</p></section>
  <section className="section-wrap agenda"><span className="section-kicker">90 MINUTES + BUFFER</span><h2>Agenda</h2>{[
   ["00–25", "Explore & run", "Get the code, trace a real jet, run the logistic baseline, open worktrees"],
   ["25–55", "Predict & experiment", "One Spark setting + your chosen model experiment in Plan mode; review both PRs"],
   ["55–70", "Merge & check", "Use the app to merge, verify GitHub, pull and check the combined result"],
   ["70–90", "Build & explain", "Your results page, a threshold slider, a confusion matrix, one decision"],
   ["Extra", "Choose your extension", "More questions, a second controlled run, Sophon, or the optional final-test challenge"],
  ].map(row => <div className="agenda-row" key={row[0]}><span className="mono">{row[0]} <small>{row[0] === 'Extra' ? '' : 'MIN'}</small></span><h3>{row[1]}</h3><p>{row[2]}</p></div>)}</section>
  <PredictionFlow/>
  <section className="split-section section-wrap"><div><span className="section-kicker">SAME DATA, FAIR COMPARISONS</span><h2>Learn, compare, then test</h2></div><div className="split-bars">{[
   ["TRAIN", "4,000", "The model learns from these examples", "67%"],
   ["VALIDATION", "1,000", "We compare models and choose what to keep", "17%"],
   ["TEST", "1,000", "Unused in the core workshop; optional final challenge", "17%"],
  ].map(row => <div className="split-row" key={row[0]}><div><span>{row[0]}</span><strong>{row[1]} <small>jets</small></strong><p>{row[2]}</p></div><i style={{width:row[3]}}/></div>)}</div></section>
  <NextChapter number="03" title="Workshop instructions" text="Start with a question. Use the short prompts when they help." onClick={()=>navigate("workshop")}/>
 </div>;
}
function NextChapter({number,title,text,onClick}:{number:string;title:string;text:string;onClick:()=>void}){return <button className="next-chapter" onClick={onClick}><span className="mono">UP NEXT / {number}</span><div><h2>{title}</h2><p>{text}</p></div><ArrowUpRight size={44} strokeWidth={1}/></button>}
