import type { Metadata } from "next";
import "./globals.css";
import "./worktree-journey.css";
import "./worktree-instructions.css";
import "./participant-account.css";
import "./participant-workspace.css";
export const metadata: Metadata = { title: "From particle collisions to better models — Ringier × OpenAI", description: "A hands-on Codex workshop in particle physics, data engineering, and machine learning", icons: {icon:"/favicon.svg"} };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
