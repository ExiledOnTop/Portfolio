// src/index.js
//
// Required environment variables / secrets (set in the Cloudflare dashboard:
// Workers & Pages -> your "portfolio" worker -> Settings -> Variables and Secrets):
//   GITHUB_TOKEN       - a GitHub personal access token with repo write access (Secret)
//   GITHUB_OWNER       - e.g. "your-username"
//   GITHUB_REPO        - e.g. "your-portfolio-repo"
//   GITHUB_BRANCH      - e.g. "main"
//   GITHUB_FILE_PATH   - e.g. "public/index.html"  (path INSIDE the repo)
//   SAVE_PASSWORD_HASH - the same sha256 hash your page's editor already
//                         checks against client-side (the _b1 constant).
//
// Your existing front-end code doesn't need to change at all — it already
// POSTs { passwordHash, html } to /api/save.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // TEMPORARY DEBUG ROUTE - remove once the Unauthorized issue is fixed
    if (url.pathname === '/api/debug' && request.method === 'GET') {
      const expected = env.SAVE_PASSWORD_HASH || '';
      return json({
        expectedLength: expected.length,
        expectedPreview: expected ? `${expected.slice(0, 6)}...${expected.slice(-6)}` : '(empty/undefined)',
        hasHiddenChars: /\s/.test(expected) || expected !== expected.trim(),
      });
    }

    if (url.pathname === '/api/save' && request.method === 'POST') {
      return handleSave(request, env);
    }

    // Everything else: serve the static file as-is.
    return env.ASSETS.fetch(request);
  },
};

async function handleSave(request, env) {
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
    // 1. Get the current file's SHA (GitHub requires this to update a file)
    const getResp = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': 'portfolio-save-worker',
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
        'User-Agent': 'portfolio-save-worker',
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

// btoa() mangles non-ASCII text; this handles UTF-8 correctly.
function base64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
