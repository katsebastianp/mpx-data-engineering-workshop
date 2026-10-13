"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { canonicalRepositoryUrl } from "../lib/progress";
import type { ParticipantAccount, ProgressMutation, ProgressResponse } from "../lib/progress";
import { workspaceForParticipant, type ParticipantWorkspace } from "../lib/participant";
import { workshopParts } from "./workshop-content";

const PROGRESS_KEY = "collision-lab:workshop-progress:v1";
const REPOSITORY_KEY = "collision-lab:workshop-repository:v1";
const stepIds = new Set(workshopParts.flatMap(part => part.exercises.map(exercise => exercise.id)));

type LegacyProgress = { completed: string[]; repository: string };
type ProgressState = {
  status: "loading" | "authenticated" | "anonymous" | "error";
  account: ParticipantAccount | null;
  workspace: ParticipantWorkspace | null;
  completed: string[];
  repository: string;
  saving: boolean;
  error: string;
  saveNotice: string;
  legacy: LegacyProgress | null;
  signInUrl: string | null;
  signOutUrl: string | null;
};

const initialState: ProgressState = {
  status: "loading", account: null, workspace: null, completed: [], repository: "", saving: false,
  error: "", saveNotice: "", legacy: null, signInUrl: null, signOutUrl: null,
};

function readLegacyProgress(): LegacyProgress | null {
  let completed: string[] = [];
  let repository = "";
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw && raw.length <= 16_384) {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) {
        completed = [...new Set(value.filter((id): id is string => typeof id === "string" && stepIds.has(id)))];
      }
    }
  } catch (error) {
    console.warn("Could not read previous browser checklist", error);
  }
  try {
    const raw = localStorage.getItem(REPOSITORY_KEY);
    if (raw && raw.length <= 2_048) repository = canonicalRepositoryUrl(raw) ?? "";
  } catch (error) {
    console.warn("Could not read previous browser repository", error);
  }
  return completed.length || repository ? { completed, repository } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readResponse(response: Response): Promise<ProgressResponse> {
  const payload = await response.json();
  if (!isRecord(payload) || typeof payload.authenticated !== "boolean") throw new Error("The progress service returned an invalid response");
  if (!payload.authenticated) {
    if (typeof payload.signInUrl !== "string") throw new Error("The progress service did not return a sign-in link");
    return { authenticated: false, signInUrl: payload.signInUrl };
  }
  const account = payload.account;
  const workspace = payload.workspace;
  if (!isRecord(account) || typeof account.subject !== "string" || !account.subject ||
      typeof account.displayName !== "string" || typeof account.email !== "string" ||
      !isRecord(workspace) || typeof workspace.id !== "string" || typeof workspace.branch !== "string" ||
      !Array.isArray(payload.completedSteps) || typeof payload.signOutUrl !== "string" ||
      !(payload.updatedAt === null || typeof payload.updatedAt === "string") ||
      !(payload.repositoryUrl === null || typeof payload.repositoryUrl === "string")) {
    throw new Error("The progress service returned incomplete account data");
  }
  return {
    authenticated: true,
    account: { subject: account.subject, displayName: account.displayName, email: account.email },
    workspace: workspaceForParticipant(workspace.id, workspace.branch),
    completedSteps: [...new Set(payload.completedSteps.filter((id: unknown): id is string => typeof id === "string" && stepIds.has(id)))],
    repositoryUrl: canonicalRepositoryUrl(payload.repositoryUrl),
    updatedAt: payload.updatedAt,
    signOutUrl: payload.signOutUrl,
  };
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (isRecord(body) && typeof body.error === "string" && body.error.length <= 400) return body.error;
  } catch { /* A gateway error may not have a JSON body */ }
  return `${fallback} (${response.status})`;
}

/** Account progress is updated only after the server confirms a save. */
export function useParticipantProgress() {
  const [state, setState] = useState<ProgressState>(initialState);
  const snapshot = useRef(state);
  const mounted = useRef(false);
  const generation = useRef(0);
  const active = useRef<{ controller: AbortController; kind: "load" | "mutation" } | null>(null);
  const refreshQueued = useRef(false);
  const legacyRead = useRef(false);
  const legacyCandidate = useRef<LegacyProgress | null>(null);
  const legacyDismissed = useRef(false);

  const update = useCallback((change: (previous: ProgressState) => ProgressState) => {
    if (!mounted.current) return;
    snapshot.current = change(snapshot.current);
    setState(snapshot.current);
  }, []);

  const applyPayload = useCallback((payload: ProgressResponse, notice?: string, error = "") => {
    update(previous => payload.authenticated ? {
      status: "authenticated", account: payload.account, workspace: payload.workspace, completed: payload.completedSteps,
      repository: payload.repositoryUrl ?? "", saving: false, error,
      saveNotice: notice ?? (previous.account?.subject === payload.account.subject ? previous.saveNotice : ""),
      legacy: legacyDismissed.current ? null : legacyCandidate.current,
      signInUrl: null, signOutUrl: payload.signOutUrl,
    } : { ...initialState, status: "anonymous", signInUrl: payload.signInUrl, error });
  }, [update]);

  const loadProgress = useCallback(async (sessionNotice = ""): Promise<void> => {
    // Let an in-flight write finish before reading its resulting state.
    if (active.current?.kind === "mutation") { refreshQueued.current = true; return; }
    active.current?.controller.abort();
    const controller = new AbortController();
    const request = ++generation.current;
    active.current = { controller, kind: "load" };
    update(previous => ({ ...previous, status: "loading", saving: false, error: sessionNotice }));
    try {
      const response = await fetch("/api/progress", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error(await responseError(response, "Could not load your progress"));
      const payload = await readResponse(response);
      if (request === generation.current && !controller.signal.aborted) applyPayload(payload, undefined, sessionNotice);
    } catch (error) {
      if (request !== generation.current || controller.signal.aborted) return;
      console.warn("Could not load account progress", error);
      // Keep the last confirmed data visible, but disable writes until identity is verified again.
      update(previous => ({ ...previous, status: "error", saving: false, error: error instanceof Error ? error.message : "Could not load your progress. Try again" }));
    } finally {
      if (request === generation.current) active.current = null;
    }
  }, [applyPayload, update]);

  const refresh = useCallback(() => loadProgress(), [loadProgress]);

  const cancelRequests = useCallback(() => {
    ++generation.current;
    active.current?.controller.abort();
    active.current = null;
    refreshQueued.current = false;
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!legacyRead.current) {
      legacyRead.current = true;
      legacyCandidate.current = readLegacyProgress();
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      cancelRequests();
      window.removeEventListener("focus", onFocus);
    };
  }, [cancelRequests, refresh]);

  const mutate = useCallback(async (mutation: ProgressMutation, notice: string): Promise<boolean> => {
    const current = snapshot.current;
    if (active.current || current.status !== "authenticated" || !current.account) return false;
    const expectedSubject = current.account.subject;
    const controller = new AbortController();
    const request = ++generation.current;
    active.current = { controller, kind: "mutation" };
    update(previous => ({ ...previous, saving: true, error: "", saveNotice: "" }));
    try {
      const response = await fetch("/api/progress", {
        method: "PATCH", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Workshop-Account": expectedSubject },
        body: JSON.stringify(mutation),
      });
      if (request !== generation.current || controller.signal.aborted) return false;
      if ([401, 403, 409].includes(response.status)) {
        active.current = null;
        refreshQueued.current = false;
        update(() => ({ ...initialState, error: "Your sign-in changed. Check your account before saving again" }));
        await loadProgress("Your sign-in changed. Check your account before saving again");
        return false;
      }
      if (!response.ok) throw new Error(await responseError(response, "Your change was not saved. Try again"));
      const payload = await readResponse(response);
      if (request !== generation.current || controller.signal.aborted) return false;
      if (!payload.authenticated || payload.account.subject !== expectedSubject) {
        active.current = null;
        refreshQueued.current = false;
        update(() => ({ ...initialState, error: "Your sign-in changed. Check your account before saving again" }));
        await loadProgress("Your sign-in changed. Check your account before saving again");
        return false;
      }
      applyPayload(payload, notice);
      return true;
    } catch (error) {
      if (request !== generation.current || controller.signal.aborted) return false;
      console.warn("Could not save account progress", error);
      update(previous => ({ ...previous, saving: false, error: error instanceof Error ? error.message : "Your change was not saved. Try again" }));
      return false;
    } finally {
      if (request === generation.current) {
        active.current = null;
        update(previous => ({ ...previous, saving: false }));
        if (refreshQueued.current) {
          refreshQueued.current = false;
          await loadProgress();
        }
      }
    }
  }, [applyPayload, loadProgress, update]);

  const setStepComplete = useCallback(async (stepId: string, completed: boolean): Promise<boolean> => {
    if (!stepIds.has(stepId)) {
      update(previous => ({ ...previous, error: "This workshop step is not recognised" }));
      return false;
    }
    return mutate({ action: "complete", stepId, completed }, completed ? "Step saved to your account" : "Step marked incomplete in your account");
  }, [mutate, update]);

  const saveRepository = useCallback(async (value: string): Promise<boolean> => {
    try {
      const repositoryUrl = canonicalRepositoryUrl(value.trim() || null);
      return await mutate({ action: "repository", repositoryUrl }, "Repository saved to your account");
    } catch (error) {
      update(previous => ({ ...previous, error: error instanceof Error ? error.message : "Enter a valid HTTPS repository URL" }));
      return false;
    }
  }, [mutate, update]);

  const dismissLegacy = useCallback(() => {
    legacyDismissed.current = true;
    update(previous => ({ ...previous, legacy: null }));
  }, [update]);

  const importLegacy = useCallback(async (): Promise<boolean> => {
    const candidate = snapshot.current.legacy;
    if (!candidate) return false;
    const saved = await mutate({ action: "import", completedSteps: candidate.completed, ...(candidate.repository ? { repositoryUrl: candidate.repository } : {}) }, "Previous browser progress imported into your account");
    if (!saved) return false;
    legacyCandidate.current = null;
    dismissLegacy();
    // Removal is best-effort; the successful server save is already authoritative.
    for (const key of [PROGRESS_KEY, REPOSITORY_KEY]) {
      try { localStorage.removeItem(key); }
      catch (error) { console.warn("Could not remove imported browser progress", error); }
    }
    return true;
  }, [dismissLegacy, mutate]);

  return { ...state, refresh, setStepComplete, saveRepository, importLegacy, dismissLegacy };
}
