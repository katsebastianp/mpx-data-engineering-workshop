"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, Copy } from "lucide-react";
import PhysicsJourney from "./PhysicsJourney";
import { PredictionFlow } from "./PredictionFlow";
import { WorkshopSteps } from "./WorkshopSteps";
import { Leaderboard } from "./Leaderboard";
import { useParticipantProgress } from "./useParticipantProgress";
import { ParticipantAccountMenu } from "./ParticipantAccount";
import { WORKSHOP_REPOSITORY_URL } from "./workshop-content";
import { WORKSHOP_READINESS_PROMPT } from "../lib/workshop-readiness";
import { codexTaskUrl } from "../lib/codex-links";

type Page = "physics" | "brief" | "workshop" | "leaderboard";
const pages: { id: Page; title: string; href: string }[] = [{id:"physics",title:"Physics",href:"/"},{id:"brief",title:"Workshop brief",href:"/brief"},{id:"workshop",title:"Instructions",href:"/workshop"},{id:"leaderboard",title:"Leaderboard",href:"/leaderboard"}];

export function CopyButton({text}:{text:string}) {
  const [status,setStatus]=useState("");
  return <button className="copy-button" onClick={async()=>{try{await navigator.clipboard.writeText(text);setStatus("Copied");setTimeout(()=>setStatus(""),1800)}catch{setStatus("Select and copy the text")}}}>{status||<>Copy <Copy size={13}/></>}</button>;
}
export function Prompt({title="Reveal Codex prompt",children,repositoryUrl=WORKSHOP_REPOSITORY_URL}:{title?:string;children:string;repositoryUrl?:string|null}) {
  const lines = children.split("\n").filter(line => line.trim());
  const bullets = lines.length > 0 && lines.every(line => line.startsWith("- "));
  return <details className="prompt"><summary><span><span className="prompt-symbol">⌘</span>{title}</span><ChevronDown size={16}/></summary><div className="prompt-content"><div className="prompt-actions"><a className="open-codex" href={codexTaskUrl(children,repositoryUrl)}>Open in Codex <ArrowUpRight size={13}/></a><CopyButton text={children}/></div>{bullets?<ul className="prompt-bullets">{lines.map((line,index)=><li key={index}>{line.slice(2)}</li>)}</ul>:<pre>{children}</pre>}</div></details>;
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
  ['Codex', 'Install Codex, sign in with your participant account and run the preparation prompt on the laptop you will bring. Use your available model; Ultra is not required.'],
  ['GitHub plugin + access', 'Confirm access to the Collision Lab repository, including branch/PR permissions and the Codex GitHub connection. Resolve missing access with the facilitator before the session.'],
  ['Container runtime ready', 'Complete the image build, setup and tests with your approved Docker setup before arrival. Docker Desktop licensing follows company policy. Existing Colima, Podman or Rancher Desktop setups must pass the same check. Linux containers use 2 CPUs and 2 GiB. If blocked, join a team with a working machine.'],
  ['Four sample files', 'Download the four files from instruction step 02. Setup verifies them without downloading a model. No host Python, Java, GPU or API key is needed for the core workshop.'],
  ['Plan, Worktree and Code Review', 'Try /side, Plan and a Worktree chat. Confirm Review PR or Code Review works for the workshop repository.'],
  ['Your account', 'Sign in here with your participant account and check your personal prompts. You will upload your final result to the Leaderboard.'],
 ];
 return <div className="brief-page">
  <section className="section-wrap requirements"><div className="section-heading"><div><span className="section-kicker">BEFORE YOU ARRIVE</span><h1>Get setup out of the way</h1></div><p>Check access on the laptop<br/>you will bring to the workshop</p></div><div className="requirement-grid">{requirements.map((row, index) => <article key={row[0]}><span className="mono">0{index+1}</span><div><h3>{row[0]}</h3><p>{row[1]}</p></div></article>)}</div><Prompt title="Check my setup in Codex">{WORKSHOP_READINESS_PROMPT}</Prompt><p className="muted-note">Open your intended Codex profile first. Review the project and prompt before sending. If the app does not open correctly, copy the prompt into your workshop project. Tell the facilitator before the session if installation is blocked.</p><p className="muted-note">A two-hour facilitation target, with setup completed beforehand. Timings vary by laptop and Codex model.</p></section>
  <section className="section-wrap agenda"><span className="section-kicker">2-HOUR SESSION</span><h2>Agenda</h2>{[
   ["00–30", "Explore & run", "Get the code, trace a real jet, run the logistic baseline, open worktrees"],
   ["30–80", "Run & explore", "One Spark setting + planned model variants; explore results, choose a model and review both PRs"],
   ["80–100", "Merge & test", "Merge both PRs, check the code and evaluate the chosen model on the test dataset"],
   ["100–105", "Publish your results", "Upload the generated JSON to the Leaderboard and confirm acceptance"],
   ["105–120", "Discuss & recover", "Questions, lessons and time for slower runs. Voice fits into the code tour; Cloud is a brief optional mention."],
   ["Extra", "Choose your extension", "Try the Sophon demo pack after the core walkthrough"],
  ].map(row => <div className="agenda-row" key={row[0]}><span className="mono">{row[0]} <small>{row[0] === 'Extra' ? '' : 'MIN'}</small></span><h3>{row[1]}</h3><p>{row[2]}</p></div>)}</section>
  <PredictionFlow/>
  <section className="split-section section-wrap"><div><span className="section-kicker">SAME DATA, FAIR COMPARISONS</span><h2>Learn, compare, then test</h2></div><div className="split-bars">{[
   ["TRAIN", "4,000", "The model learns from these examples", "67%"],
   ["VALIDATION", "1,000", "We compare models and choose what to keep", "17%"],
   ["TEST", "1,000", "Used once after model selection, for the final submission", "17%"],
  ].map(row => <div className="split-row" key={row[0]}><div><span>{row[0]}</span><strong>{row[1]} <small>jets</small></strong><p>{row[2]}</p></div><i style={{width:row[3]}}/></div>)}</div></section>
  <NextChapter number="03" title="Workshop instructions" text="Start with a question. Use the short prompts when they help." onClick={()=>navigate("workshop")}/>
 </div>;
}
function NextChapter({number,title,text,onClick}:{number:string;title:string;text:string;onClick:()=>void}){return <button className="next-chapter" onClick={onClick}><span className="mono">UP NEXT / {number}</span><div><h2>{title}</h2><p>{text}</p></div><ArrowUpRight size={44} strokeWidth={1}/></button>}
