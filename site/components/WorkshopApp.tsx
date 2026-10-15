"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, Copy, CircleHelp } from "lucide-react";
import PhysicsJourney from "./PhysicsJourney";
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
 return <><a href="#content" className="skip-link">Skip to content</a><header className="site-header"><a href="/" className="wordmark" onClick={e=>{e.preventDefault();navigate("physics")}} aria-label="From particle collisions to better models home"><span className="brand-mark"><i/><i/><i/></span><span>COLLISIONS<span className="wordmark-light"> / MODELS</span></span></a><nav aria-label="Chapters">{pages.map((p,i)=><a href={p.href} aria-current={page===p.id?"page":undefined} onClick={e=>{e.preventDefault();navigate(p.id)}} key={p.id}><span>0{i+1}</span>{p.title}</a>)}</nav><ParticipantAccountMenu participant={participant}/></header><main id="content" key={page}>{page==="physics"?<Physics navigate={navigate}/>:page==="brief"?<Brief navigate={navigate}/>:page==="workshop"?<WorkshopSteps participant={participant}/>:<Leaderboard participant={participant}/>}</main><footer className="footer"><span>COLLISIONS / MODELS</span><span>Ringier × OpenAI · Codex workshop</span><span>JetClass-II simulated data · Codex workshop</span></footer></>;
}

function Physics({navigate}:{navigate:(p:Page)=>void}){
 return <><PhysicsJourney/>
 <section className="intro-text section-wrap" id="workshop-data"><span className="section-kicker">THE WORKSHOP DATA</span><div><h2>Learning from simulated collisions</h2><ul className="plain-bullets"><li>We use a small, reproducible sample of simulated jets from JetClass-II</li><li>Each jet has a known origin, so we can measure how well a model recognises it</li><li>The goal is to improve the pipeline, compare models, and explain the results</li></ul><a className="text-link" href="https://home.cern/science/accelerators/large-hadron-collider" target="_blank" rel="noreferrer">More about the LHC at CERN <ArrowUpRight size={14}/></a></div></section>
 <section className="data-section section-wrap"><div className="section-heading"><div><span className="section-kicker">THE LEARNING PROBLEM</span><h2>What the model predicts</h2></div><p>Is this jet signal or QCD background?</p></div><div className="classification"><div><span className="mono accent">01</span><h3>Signal <span>(X → bb)</span></h3><p>A jet from the decay of a simulated particle X into a bottom-quark pair.</p></div><div className="classification-separator">or</div><div><span className="mono">02</span><h3>QCD background <span>(ordinary jets)</span></h3><p>An ordinary jet produced by quarks or gluons.</p></div></div><div className="feature-list"><div className="feature-list-head"><h3>The eight input features</h3><p>Simulation labels are used only for training and evaluation</p></div>{[["jet_pt","Momentum across the beam","GeV"],["jet_sdmass","Mass after removing soft, wide-angle radiation","GeV"],["particle_count","Number of reconstructed particles","count"],["energy_sum","Total constituent energy","GeV"],["leading_energy_fraction","Energy share of the leading particle","fraction"],["radial_energy_moment","Energy-weighted angular spread","angular"],["energy_dispersion","How concentrated the energy is","ratio"],["ecf2_beta1","Energy-weighted particle-pair separation","angular"]].map((r,i)=><div className="feature-row" key={r[0]}><span>0{i+1}</span><code>{r[0]}</code><p>{r[1]}</p><small>{r[2]}</small></div>)}</div><div className="honesty-note"><CircleHelp size={20}/><p><strong>About these scores</strong> These are simulated data. Higher scores mean more signal-like, not calibrated probabilities. Angular coordinates describe directions, not physical detector positions.</p></div><div className="sources"><span>READ FURTHER</span><a href="https://huggingface.co/datasets/jet-universe/jetclass2" target="_blank" rel="noreferrer">JetClass-II dataset <ArrowUpRight size={12}/></a><a href="https://huggingface.co/jet-universe/sophon" target="_blank" rel="noreferrer">Sophon reference <ArrowUpRight size={12}/></a><a href="https://arxiv.org/abs/1402.2657" target="_blank" rel="noreferrer">Soft Drop <ArrowUpRight size={12}/></a></div></section><NextChapter number="02" title="Workshop brief" text="Objectives, prerequisites, and agenda" onClick={()=>navigate("brief")}/></>;
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
  <ChapterIntro number="02" eyebrow="THE BRIEF" title="Workshop overview" description="Trace real data, test a pipeline change, and compare two models. About 90 minutes, plus setup and questions."/>
  <section className="brief-outcomes section-wrap"><span className="section-kicker">THREE THINGS TO LEARN</span><div className="outcome-grid">{[
   ["01", "Follow real data", "Click through one actual jet: particle measurements → features → model score. Find the function behind each step."],
   ["02", "Test your prediction", "Change one Spark setting. Use Plan mode to design a small model comparison. Decide whether the result supports your hypothesis."],
   ["03", "Make the trade-off visible", "Review and merge your PRs, then build your own small results page. Move a threshold and explain what the model gets wrong."],
  ].map(row => <article key={row[0]}><span className="outcome-number">{row[0]}</span><h3>{row[1]}</h3><p>{row[2]}</p></article>)}</div>
  <p className="muted-note">No need to write Python yourself. Focus on the questions and results; inspect the code if you want to go deeper.</p></section>
  <section className="split-section section-wrap"><div><span className="section-kicker">SAME DATA, FAIR COMPARISONS</span><h2>Learn, compare, then test</h2></div><div className="split-bars">{[
   ["TRAIN", "4,000", "The model learns from these examples", "67%"],
   ["VALIDATION", "1,000", "We compare models and choose what to keep", "17%"],
   ["TEST", "1,000", "Unused in the core workshop; optional final challenge", "17%"],
  ].map(row => <div className="split-row" key={row[0]}><div><span>{row[0]}</span><strong>{row[1]} <small>jets</small></strong><p>{row[2]}</p></div><i style={{width:row[3]}}/></div>)}</div></section>
  <section className="section-wrap requirements"><div className="section-heading"><div><span className="section-kicker">BEFORE YOU ARRIVE</span><h2>Get setup out of the way</h2></div><p>Check access on the laptop<br/>you will bring to the workshop</p></div><div className="requirement-grid">{requirements.map((row, index) => <article key={row[0]}><span className="mono">0{index+1}</span><div><h3>{row[0]}</h3><p>{row[1]}</p></div></article>)}</div><p className="muted-note">The timings below are a facilitation target. First-time Docker builds and slower laptops can take longer. Keep max_workers at 1 and ask for help if setup stalls.</p></section>
  <section className="section-wrap agenda"><span className="section-kicker">90 MINUTES + BUFFER</span><h2>Agenda</h2>{[
   ["00–25", "Explore & run", "Get the code, trace a real jet, run two small models, open worktrees"],
   ["25–55", "Predict & experiment", "One Spark setting + one model comparison designed in Plan mode; review both PRs"],
   ["55–70", "Merge & check", "Use the app to merge, verify GitHub, pull and check the combined result"],
   ["70–90", "Build & explain", "Your results page, a threshold slider, a confusion matrix, one decision"],
   ["Extra", "Choose your extension", "More questions, a second controlled run, Sophon, or the optional final-test challenge"],
  ].map(row => <div className="agenda-row" key={row[0]}><span className="mono">{row[0]} <small>{row[0] === 'Extra' ? '' : 'MIN'}</small></span><h3>{row[1]}</h3><p>{row[2]}</p></div>)}</section>
  <NextChapter number="03" title="Workshop instructions" text="Start with a question. Use the short prompts when they help." onClick={()=>navigate("workshop")}/>
 </div>;
}
function NextChapter({number,title,text,onClick}:{number:string;title:string;text:string;onClick:()=>void}){return <button className="next-chapter" onClick={onClick}><span className="mono">UP NEXT / {number}</span><div><h2>{title}</h2><p>{text}</p></div><ArrowUpRight size={44} strokeWidth={1}/></button>}
