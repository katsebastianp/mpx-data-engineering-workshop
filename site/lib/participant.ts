/** Stable workshop names; profile names and email addresses never enter commands. */
export type ParticipantWorkspace = {
  id: string;
  runName: string | null;
  branch: string;
  pipelineBranch: string;
  modelsBranch: string;
  integrationBranch: string;
  composePrefix: string;
};

export function workspaceForParticipant(id: string, branch = `participant-${id.slice(2, 10)}`, runName: string | null = null): ParticipantWorkspace {
  if (!/^p-[a-f0-9]{16}$/.test(id)) throw new Error("Invalid participant workspace");
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(branch) || branch.length > 48 || ["main", "master", "head"].includes(branch)) throw new Error("Invalid personal branch name");
  if (runName !== null && runName !== branch) throw new Error("Run name must match its branch");
  return {
    id, runName, branch, pipelineBranch: `${branch}-pipeline_optimization`,
    modelsBranch: `${branch}-predictive_models`, integrationBranch: branch,
    composePrefix: `ws-${runName ?? id}`,
  };
}

/** Call with the platform-authenticated subject on the server, never form input. */
export async function participantWorkspaceFor(subject: string, branch?: string): Promise<ParticipantWorkspace> {
  if (!subject) throw new Error("An authenticated participant is required");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`collision-lab:participant:v1:${subject}`));
  const id = `p-${Array.from(new Uint8Array(digest)).slice(0, 8).map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
  return workspaceForParticipant(id, branch);
}

/** Only controlled identifiers and an already-validated repository URL are templated. */
export function personaliseWorkshopText(text: string, workspace: ParticipantWorkspace, repositoryUrl: string | null): string {
  const names = workspaceForParticipant(workspace.id, workspace.branch, workspace.runName);
  const values: Record<string, string> = {
    participantId: names.id,
    runName: names.runName ?? names.branch,
    branch: names.branch,
    pipelineBranch: names.pipelineBranch,
    modelsBranch: names.modelsBranch,
    integrationBranch: names.integrationBranch,
    composePrefix: names.composePrefix,
    repositoryUrl: repositoryUrl || "the repository URL supplied by my facilitator (ask me for it if it is not available)",
  };
  return text.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`Unknown workshop placeholder: ${key}`);
    return values[key];
  });
}
