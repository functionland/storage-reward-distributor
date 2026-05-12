/**
 * Minimal GitHub API helpers for reading state and writing inbox.
 *
 * PAT requirements (documented in docs/OPERATIONS.md):
 *  - Fine-grained PAT, not classic
 *  - Repository access: only this repo
 *  - Permissions: Contents → Read and Write (everything else: No access)
 *  - Expiration: ≤ 7 days
 *
 * The PAT is held in sessionStorage (NOT localStorage) so it dies when the
 * browser tab closes. The user re-enters it each session.
 */

const RAW_BASE = "https://raw.githubusercontent.com";
const API_BASE = "https://api.github.com";

export interface RepoCoords {
  owner: string;
  repo: string;
  branch: string;
}

export function getRepoCoords(): RepoCoords {
  return {
    owner: import.meta.env.VITE_REPO_OWNER || inferOwnerFromPathname(),
    repo: import.meta.env.VITE_REPO_NAME || inferRepoFromPathname(),
    branch: "main",
  };
}

function inferOwnerFromPathname(): string {
  // GitHub Pages serves user.github.io/repo. The hostname's subdomain prefix
  // is the org/user.
  const host = window.location.hostname;
  const idx = host.indexOf(".github.io");
  if (idx > 0) return host.slice(0, idx);
  return "";
}

function inferRepoFromPathname(): string {
  const parts = window.location.pathname.split("/").filter((s) => s.length > 0);
  return parts[0] || "";
}

const PAT_KEY = "srd_pat_v1";

export function getPat(): string | null {
  return sessionStorage.getItem(PAT_KEY);
}
export function setPat(pat: string): void {
  sessionStorage.setItem(PAT_KEY, pat);
}
export function clearPat(): void {
  sessionStorage.removeItem(PAT_KEY);
}

export interface FetchFileResult<T> {
  content: T;
  sha: string;
}

/** Fetch the current contents of a file (read-only). Uses raw.githubusercontent for speed. */
export async function fetchRaw(path: string): Promise<string> {
  const { owner, repo, branch } = getRepoCoords();
  const url = `${RAW_BASE}/${owner}/${repo}/${branch}/${path}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${path}: ${res.status}`);
  return await res.text();
}

/** Fetch via authenticated API (returns sha needed to update the file). */
export async function fetchFile<T = unknown>(path: string): Promise<FetchFileResult<T>> {
  const pat = getPat();
  if (!pat) throw new Error("No PAT set");
  const { owner, repo, branch } = getRepoCoords();
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  const json = await res.json();
  // GitHub returns content as base64.
  const decoded = atob(json.content.replace(/\n/g, ""));
  const content = JSON.parse(decoded) as T;
  return { content, sha: json.sha };
}

/** Write a file via API. */
export async function putFile(
  path: string,
  content: unknown,
  sha: string,
  message: string,
): Promise<void> {
  const pat = getPat();
  if (!pat) throw new Error("No PAT set");
  const { owner, repo, branch } = getRepoCoords();
  const url = `${API_BASE}/repos/${owner}/${repo}/contents/${path}`;
  const body = {
    message,
    branch,
    sha,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2) + "\n"))),
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${path}: ${res.status} — ${text}`);
  }
}

export async function whoami(): Promise<string> {
  const pat = getPat();
  if (!pat) throw new Error("No PAT set");
  const res = await fetch(`${API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GET /user: ${res.status}`);
  const json = await res.json();
  return json.login as string;
}
