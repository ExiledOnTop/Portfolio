// Cloudflare Pages Function: POST /api/save
// Verifies the edit password, then commits the updated page content
// to your GitHub repo as both state.json (a snapshot) and index.html (the live file).
//
// Required Cloudflare Pages environment variables (set in project Settings > Environment variables):
//   GITHUB_TOKEN        - fine-grained GitHub PAT, scoped to this repo, "Contents: Read and write"
//   GITHUB_OWNER        - your GitHub username or org, e.g. "yourname"
//   GITHUB_REPO         - repo name, e.g. "my-site"
//   GITHUB_BRANCH       - branch to commit to, e.g. "main" (defaults to "main" if unset)
//   EDIT_PASSWORD_HASH  - same SHA-256 hash used in index.html, so the server double-checks it

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { passwordHash, html } = body;

  if (!passwordHash || passwordHash !== env.EDIT_PASSWORD_HASH) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (!html || typeof html !== "string") {
    return json({ ok: false, error: "Missing html" }, 400);
  }

  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const token = env.GITHUB_TOKEN;

  const statePayload = JSON.stringify(
    { html, updatedAt: new Date().toISOString() },
    null,
    2
  );

  try {
    await commitFile({
      owner, repo, branch, token,
      path: "state.json",
      content: statePayload,
      message: "chore: update state.json via site editor",
    });
    await commitFile({
      owner, repo, branch, token,
      path: "index.html",
      content: html,
      message: "chore: update index.html via site editor",
    });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }

  return json({ ok: true });
}

async function commitFile({ owner, repo, branch, token, path, content, message }) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;

  // Look up the current file's SHA — GitHub requires this to update an existing file.
  let sha;
  const getResp = await fetch(`${apiUrl}?ref=${branch}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "cf-pages-save-function",
      Accept: "application/vnd.github+json",
    },
  });
  if (getResp.ok) {
    const data = await getResp.json();
    sha = data.sha;
  } else if (getResp.status !== 404) {
    throw new Error(`GitHub GET failed for ${path}: ${getResp.status}`);
  }

  const putResp = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "cf-pages-save-function",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: base64Encode(content),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putResp.ok) {
    const errText = await putResp.text();
    throw new Error(`GitHub PUT failed for ${path}: ${putResp.status} ${errText}`);
  }
}

function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
