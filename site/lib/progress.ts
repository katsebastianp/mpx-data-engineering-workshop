import type { ParticipantWorkspace } from "./participant";

/** Browser-safe request/response contract. Never infer identity from this data. */
export type ParticipantAccount = { subject: string; displayName: string; email: string };
export type AuthenticatedProgress = {
  authenticated: true;
  account: ParticipantAccount;
  workspace: ParticipantWorkspace;
  availableRuns: string[];
  completedSteps: string[];
  repositoryUrl: string | null;
  updatedAt: string | null;
  signOutUrl: string;
};
export type AnonymousProgress = { authenticated: false; signInUrl: string };
export type ProgressResponse = AuthenticatedProgress | AnonymousProgress;
export type ProgressMutation =
  | { action: "run"; name: string | null }
  | { action: "complete"; stepId: string; completed: boolean }
  | { action: "repository"; repositoryUrl: string | null }
  | { action: "import"; completedSteps: string[]; repositoryUrl?: string | null };

/** A profile's first name is only a branch preference; the server allocates it once. */
export function participantBranchCandidates(fullName: string | null, participantId: string): string[] {
  if (!/^p-[a-f0-9]{16}$/.test(participantId)) throw new Error("Invalid participant identity");
  const suffix = participantId.slice(2);
  const token = fullName?.trim().split(/\s+/u)[0] ?? "";
  const normalized = token.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/g, "");
  // Do not use email as a profile name or offer common shared base branches.
  const reserved = new Set(["main", "master", "head", "trunk", "develop"]);
  const fallback = `participant-${suffix}`;
  const preferred = /^[a-z]/.test(normalized) && !token.includes("@") && !reserved.has(normalized) ? normalized : fallback;
  return [...new Set([preferred, `${preferred.slice(0, 23).replace(/-+$/g, "")}-${suffix.slice(0, 8)}`, fallback])];
}

export const MAX_PROGRESS_BYTES = 16 * 1024;

export class ProgressError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProgressError";
    this.status = status;
  }
}

/** Links are stored for the participant, never fetched by the server. */
export function canonicalRepositoryUrl(value: unknown): string | null {
  if (value === null) return null;
  const message = "Use an HTTPS repository URL with an owner and repository name, without credentials, query parameters, or fragments.";
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value.trim()) || /[\u0000-\u001f\u007f]/.test(value)) throw new ProgressError(message);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new ProgressError(message); }
  const path = url.pathname.replace(/\/$/, "");
  // Validate the original path as well, so dot-segment normalization cannot
  // quietly turn a different URL into an apparently valid repository link.
  const originalPath = /^https:\/\/[^/?#]+(\/[^?#]*)$/i.exec(value.trim())?.[1]?.replace(/\/$/, "");
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash || originalPath !== path || !/^\/[A-Za-z0-9_.~-]+\/[A-Za-z0-9_.~-]+$/.test(path)) throw new ProgressError(message);
  url.pathname = path;
  return url.toString();
}

/** Refuse cross-origin mutations and writes from a tab showing another account. */
export function assertProgressWriteContext(request: Request, authenticatedSubject: string): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || (fetchSite && fetchSite !== "same-origin") || (!origin && fetchSite !== "same-origin")) {
    throw new ProgressError("Save progress from this site's workshop page.", 403);
  }
  if (request.headers.get("x-workshop-account") !== authenticatedSubject) {
    throw new ProgressError("Your signed-in account changed. Refresh your progress before saving.", 409);
  }
}

/** Keep payloads shallow and reject duplicate fields before JSON.parse. */
export function parseProgressJson(source: string): unknown {
  let depth = 0;
  const keys = new Set<string>();
  try {
    for (let i = 0; i < source.length; i++) {
      const character = source[i];
      if (character === '"') {
        const start = i++;
        for (; i < source.length && source[i] !== '"'; i++) if (source[i] === "\\") i++;
        if (i >= source.length) throw new Error("Unterminated string");
        if (depth === 1) {
          let next = i + 1;
          while (/\s/.test(source[next] ?? "") && next < source.length) next++;
          if (source[next] === ":") {
            const key = JSON.parse(source.slice(start, i + 1)) as string;
            if (keys.has(key)) throw new ProgressError("Progress JSON must not repeat field names.");
            keys.add(key);
          }
        }
      } else if (character === "{" || character === "[") {
        if (++depth > 2) throw new ProgressError("Progress JSON must contain only the requested action and its values.");
      } else if (character === "}" || character === "]") depth--;
    }
    return JSON.parse(source);
  } catch (error) {
    if (error instanceof ProgressError) throw error;
    throw new ProgressError("Send valid JSON progress data.");
  }
}

export function validateProgressMutation(value: unknown, validStepIds: ReadonlySet<string>): ProgressMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProgressError("Send a progress action.");
  const payload = value as Record<string, unknown>;
  const exactKeys = (required: string[], optional: string[] = []) => {
    const permitted = new Set([...required, ...optional]);
    if (Object.keys(payload).some((key) => !permitted.has(key)) || required.some((key) => !Object.hasOwn(payload, key))) throw new ProgressError("Progress action contains missing or unsupported fields.");
  };
  const stepId = (id: unknown): string => {
    if (typeof id !== "string" || !validStepIds.has(id)) throw new ProgressError("Choose a valid workshop step.");
    return id;
  };
  if (payload.action === "run") {
    exactKeys(["action", "name"]);
    return { action: "run", name: payload.name === null ? null : validateRunName(payload.name) };
  }
  if (payload.action === "complete") {
    exactKeys(["action", "stepId", "completed"]);
    if (typeof payload.completed !== "boolean") throw new ProgressError("Step completion must be true or false.");
    return { action: "complete", stepId: stepId(payload.stepId), completed: payload.completed };
  }
  if (payload.action === "repository") {
    exactKeys(["action", "repositoryUrl"]);
    return { action: "repository", repositoryUrl: canonicalRepositoryUrl(payload.repositoryUrl) };
  }
  if (payload.action === "import") {
    exactKeys(["action", "completedSteps"], ["repositoryUrl"]);
    if (!Array.isArray(payload.completedSteps) || payload.completedSteps.length > validStepIds.size) throw new ProgressError("Import only the workshop's completed steps.");
    const completedSteps = [...new Set(payload.completedSteps.map(stepId))];
    return {
      action: "import", completedSteps,
      ...(Object.hasOwn(payload, "repositoryUrl") ? { repositoryUrl: canonicalRepositoryUrl(payload.repositoryUrl) } : {}),
    };
  }
  throw new ProgressError("Choose a supported progress action.");
}

export async function readProgressMutation(request: Request, validStepIds: ReadonlySet<string>): Promise<ProgressMutation> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ProgressError("Send progress as application/json.", 415);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_PROGRESS_BYTES)) throw new ProgressError("Progress data exceeds the 16 KB limit.", 413);
  if (!request.body) throw new ProgressError("Progress data is empty.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let source = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_PROGRESS_BYTES) {
        await reader.cancel();
        throw new ProgressError("Progress data exceeds the 16 KB limit.", 413);
      }
      source += decoder.decode(next.value, { stream: true });
    }
    source += decoder.decode();
  } catch (error) {
    if (error instanceof ProgressError) throw error;
    throw new ProgressError("Progress data could not be read as UTF-8 JSON.");
  } finally { reader.releaseLock(); }
  return validateProgressMutation(parseProgressJson(source), validStepIds);
}

export function validateRunName(value: unknown): string {
  if (typeof value !== "string" || value.length > 48 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || ["main", "master", "head", "trunk", "develop"].includes(value)) {
    throw new ProgressError("Use a name like leon-test1: lowercase letters, numbers and hyphens, starting with a letter (max 48 characters).");
  }
  return value;
}
