// functions/api/save.js
// Cloudflare Pages Function — handles POST /api/save
//
// Required environment variables (set in Cloudflare Pages dashboard ->
// Settings -> Environment variables -> Production, as *secrets*):
//   GITHUB_TOKEN     - a GitHub personal access token with repo write access
//   GITHUB_OWNER     - e.g. "your-username"
//   GITHUB_REPO      - e.g. "your-portfolio"
//   GITHUB_BRANCH    - e.g. "main"
//   GITHUB_FILE_PATH - e.g. "index.html"
//   SAVE_PASSWORD_HASH - the SAME sha256 hash your front-end already checks
//                         against (the _b1 constant in your page's script).
//
// IMPORTANT: your current page checks the password purely client-side
// before ever calling this endpoint. That check is trivially bypassable
// (anyone can open devtools and call fetch('/api/save', ...) directly).
// This function re-checks the password hash server-side so a stolen/guessed
// call can't write to your repo without it.

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { passwordHash, html } = body || {};

  if (!passwordHash || passwordHash !== env.SAVE_PASSWORD_HASH) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }
  if (typeof html !== 'string' || html.length < 10) {
    return json({ ok: false, error: 'Missing or invalid html' }, 400);
  }

  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, GITHUB_FILE_PATH } = env;

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;

  try {
    // 1. Get the current file's SHA (required by GitHub to update a file)
    const getResp = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'cf-pages-save-function',
        Accept: 'application/vnd.github+json',
      },
    });

    if (!getResp.ok) {
      const errText = await getResp.text();
      return json({ ok: false, error: `GitHub GET failed: ${getResp.status} ${errText}` }, 502);
    }

    const currentFile = await getResp.json();
    const sha = currentFile.sha;

    // 2. PUT the updated content (base64-encoded, GitHub requirement)
    const putResp = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'cf-pages-save-function',
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Update site content via editor',
        content: base64Encode(html),
        sha,
        branch: GITHUB_BRANCH,
      }),
    });

    if (!putResp.ok) {
      const errText = await putResp.text();
      return json({ ok: false, error: `GitHub PUT failed: ${putResp.status} ${errText}` }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: `Unexpected error: ${err.message}` }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// btoa() doesn't handle UTF-8 safely; this does.
function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
