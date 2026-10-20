/** Prefill a new chat. The participant reviews the project and sends it. */
export function codexTaskUrl(prompt: string, repositoryUrl?: string | null): string {
  const link = new URL("codex://threads/new");
  link.searchParams.set("prompt", prompt);
  if (repositoryUrl) link.searchParams.set("originUrl", repositoryUrl);
  return link.toString();
}
