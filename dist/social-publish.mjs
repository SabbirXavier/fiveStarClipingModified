import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const GRAPH_VERSION = "v22.0";
const YT_CALLBACK_HOST = "127.0.0.1";
const YT_CALLBACK_PORT = 8765;
const YT_CALLBACK_PATH = "/oauth/youtube/callback";
const YT_REDIRECT_URI = `http://${YT_CALLBACK_HOST}:${YT_CALLBACK_PORT}${YT_CALLBACK_PATH}`;
const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

const DEFAULT_STORE = {
  youtube: {
    clientId: "",
    clientSecret: "",
    accessToken: "",
    refreshToken: "",
    expiryDate: 0,
    channelId: "",
    channelTitle: "",
    channelHandle: "",
  },
  instagram: {
    igUserId: "",
    accessToken: "",
    appId: "",
    appSecret: "",
    username: "",
    name: "",
    tokenExpiresAt: 0,
  },
};

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function makeError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function getBaseUrl(req) {
  const host = req.get("host") || "localhost:5177";
  const proto = req.protocol === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

function getRedirectUri() {
  return YT_REDIRECT_URI;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatGoogleError(data, fallback) {
  const msg = data?.error_description || data?.error?.message || data?.error || fallback;
  const reason = data?.error?.errors?.[0]?.reason;
  if (reason === "quotaExceeded") {
    return "YouTube API daily upload quota exceeded. Try again after quota resets (midnight Pacific Time).";
  }
  if (reason === "youtubeSignupRequired") {
    return "This Google account does not have a YouTube channel yet. Create one on YouTube first.";
  }
  if (data?.error === "invalid_grant") {
    return "YouTube authorization expired or was revoked. Reconnect your YouTube channel in Settings.";
  }
  if (data?.error === "invalid_client") {
    return "Invalid YouTube OAuth Client ID or Client Secret. Check your Google Cloud credentials in Settings.";
  }
  return String(msg || fallback);
}

function formatMetaError(data, fallback) {
  const err = data?.error;
  if (!err) return fallback;
  const msg = err.error_user_msg || err.message || fallback;
  return err.code ? `${msg} (Meta error ${err.code})` : msg;
}

function cleanYouTubeTags(raw) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed : raw.split(/[\s,]+/);
    } catch {
      list = raw.split(/[\s,]+/);
    }
  }
  const tags = [];
  let totalLen = 0;
  for (const item of list) {
    const clean = String(item ?? "")
      .replace(/^#+/, "")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 60);
    if (!clean) continue;
    if (tags.some((t) => t.toLowerCase() === clean.toLowerCase())) continue;
    const cost = clean.length + (clean.includes(" ") ? 2 : 0) + 1;
    if (totalLen + cost > 460) break;
    tags.push(clean);
    totalLen += cost;
  }
  return tags;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerSocialRoutes(app, deps) {
  const { dataDir, getProjectAndClip, projectDir, saveProject, getSettings, saveSettings, uploadSingleFile } = deps;
  const storePath = path.join(dataDir, "social-accounts.json");
  const pendingStates = new Map();

  function loadStore() {
    try {
      const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
      return {
        youtube: { ...DEFAULT_STORE.youtube, ...(raw?.youtube || {}) },
        instagram: { ...DEFAULT_STORE.instagram, ...(raw?.instagram || {}) },
      };
    } catch {
      return structuredClone(DEFAULT_STORE);
    }
  }

  function saveStore(store) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${storePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, storePath);
  }

  function publicStatus(req, store = loadStore()) {
    const yt = store.youtube;
    const ig = store.instagram;
    return {
      youtube: {
        configured: Boolean(yt.clientId && yt.clientSecret),
        connected: Boolean(yt.clientId && yt.clientSecret && (yt.refreshToken || yt.accessToken)),
        clientId: yt.clientId || "",
        hasClientSecret: Boolean(yt.clientSecret),
        channelId: yt.channelId || "",
        channelTitle: yt.channelTitle || "",
        channelHandle: yt.channelHandle || "",
        redirectUri: getRedirectUri(req),
      },
      instagram: {
        configured: Boolean(ig.accessToken && ig.igUserId),
        connected: Boolean(ig.accessToken && ig.igUserId),
        igUserId: ig.igUserId || "",
        username: ig.username || "",
        name: ig.name || "",
        appId: ig.appId || "",
        hasAccessToken: Boolean(ig.accessToken),
        hasAppSecret: Boolean(ig.appSecret),
        tokenExpiresAt: ig.tokenExpiresAt || 0,
      },
    };
  }

  async function ensureYouTubeAccessToken(store) {
    const yt = store.youtube;
    if (!yt.clientId || !yt.clientSecret) {
      throw makeError(400, "Add your YouTube OAuth Client ID and Client Secret in Settings first.");
    }
    if (!yt.refreshToken && !yt.accessToken) {
      throw makeError(400, "Connect your YouTube channel in Settings first.");
    }
    if (yt.accessToken && yt.expiryDate && Date.now() < yt.expiryDate - 120_000) {
      return yt.accessToken;
    }
    if (!yt.refreshToken) {
      if (yt.accessToken) return yt.accessToken;
      throw makeError(401, "YouTube session expired. Reconnect your channel in Settings.");
    }

    const body = new URLSearchParams({
      client_id: yt.clientId,
      client_secret: yt.clientSecret,
      refresh_token: yt.refreshToken,
      grant_type: "refresh_token",
    });

    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await resp.text();
    const data = parseJsonSafe(text);
    if (!resp.ok || !data?.access_token) {
      if (data?.error === "invalid_grant") {
        yt.accessToken = "";
        yt.refreshToken = "";
        yt.expiryDate = 0;
        saveStore(store);
      }
      throw makeError(401, formatGoogleError(data, `Could not refresh YouTube token (HTTP ${resp.status}).`));
    }

    yt.accessToken = data.access_token;
    yt.expiryDate = Date.now() + (Number(data.expires_in) || 3500) * 1000;
    saveStore(store);
    return yt.accessToken;
  }

  async function fetchYouTubeChannelInfo(accessToken) {
    const resp = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const data = parseJsonSafe(await resp.text());
    if (!resp.ok) {
      throw makeError(resp.status, formatGoogleError(data, "Could not read YouTube channel details."));
    }
    const ch = data?.items?.[0];
    if (!ch) {
      throw makeError(400, "No YouTube channel was found on that Google account.");
    }
    return {
      channelId: ch.id || "",
      channelTitle: ch.snippet?.title || "YouTube Channel",
      channelHandle: ch.snippet?.customUrl || "",
    };
  }

  async function resolveClipVideoFile(req, project, clip) {
    if (req.file?.path) {
      const stat = fs.statSync(req.file.path);
      return { filePath: req.file.path, size: stat.size, cleanup: true };
    }
    if (project.source?.kind === "local") {
      throw makeError(
        400,
        "For local-file projects, choose your exported MP4 file to upload (browser exports stay on your computer)."
      );
    }
    if (!clip.output?.file || clip.output.file === "local") {
      throw makeError(400, "Export the MP4 first, then click Upload.");
    }
    const fullPath = path.resolve(projectDir(project.id), clip.output.file);
    const baseDir = path.resolve(projectDir(project.id));
    if (!fullPath.startsWith(baseDir + path.sep)) {
      throw makeError(400, "Invalid clip output path.");
    }
    if (!fs.existsSync(fullPath)) {
      throw makeError(404, "The exported MP4 file is missing. Click Export MP4 again.");
    }
    const stat = fs.statSync(fullPath);
    return { filePath: fullPath, size: stat.size, cleanup: false };
  }

  function optionalMultipart(req, res, next) {
    if (req.is("multipart/form-data")) {
      return uploadSingleFile(req, res, next);
    }
    return next();
  }

  function renderCallbackHtml({
    ok,
    title,
    detail,
    channelTitle = "",
    channelHandle = "",
    openerOrigin = "*",
  }) {
    const payload = JSON.stringify({
      type: "fivestar-youtube-auth",
      ok,
      channelTitle,
      channelHandle,
      error: ok ? "" : detail,
    });
    const targetOrigin = JSON.stringify(openerOrigin || "*");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} — Fivestar</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#170d26;color:#fff3e4;font:16px/1.5 system-ui,-apple-system,sans-serif;padding:24px}
    .card{max-width:460px;width:100%;background:#221438;border:1px solid #422c63;border-radius:14px;padding:24px;box-shadow:0 16px 40px rgba(0,0,0,.4)}
    h1{margin:0 0 8px;font-size:20px;color:${ok ? "#86efac" : "#fca5a5"}}
    p{margin:0 0 16px;color:#d6c8eb}
    button{background:linear-gradient(90deg,#ff6a88,#ffd166);color:#1a0f2b;border:0;border-radius:8px;padding:10px 16px;font:600 14px system-ui,sans-serif;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(detail)}</p>
    <button onclick="window.close()">Close window</button>
  </div>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(${payload}, ${targetOrigin});
      }
    } catch {}
    ${ok ? "setTimeout(() => { try { window.close(); } catch {} }, 1400);" : ""}
  </script>
</body>
</html>`;
  }

  async function processYouTubeCallback(query) {
    const errParam = typeof query.error === "string" ? query.error : "";
    const code = typeof query.code === "string" ? query.code : "";
    const state = typeof query.state === "string" ? query.state : "";

    const stateInfo = pendingStates.get(state);
    if (state) pendingStates.delete(state);
    const openerOrigin = stateInfo?.openerOrigin || "http://localhost:5177";

    if (errParam) {
      return {
        status: 400,
        html: renderCallbackHtml({
          ok: false,
          title: "YouTube connection cancelled",
          detail: `Google returned: ${errParam}`,
          openerOrigin,
        }),
      };
    }

    if (!stateInfo || Date.now() - stateInfo.createdAt > 15 * 60_000) {
      return {
        status: 400,
        html: renderCallbackHtml({
          ok: false,
          title: "Sign-in expired",
          detail:
            "That authorization link expired or was already used. Close this tab and click Connect YouTube again.",
          openerOrigin,
        }),
      };
    }

    if (!code) {
      return {
        status: 400,
        html: renderCallbackHtml({
          ok: false,
          title: "Missing authorization code",
          detail: "Google did not return an authorization code. Try connecting again.",
          openerOrigin,
        }),
      };
    }

    const store = loadStore();
    if (!store.youtube.clientId || !store.youtube.clientSecret) {
      return {
        status: 400,
        html: renderCallbackHtml({
          ok: false,
          title: "Missing credentials",
          detail: "YouTube Client ID or Client Secret is not saved in Settings.",
          openerOrigin,
        }),
      };
    }

    try {
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: store.youtube.clientId,
          client_secret: store.youtube.clientSecret,
          redirect_uri: stateInfo.redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokenData = parseJsonSafe(await tokenResp.text());
      if (!tokenResp.ok || !tokenData?.access_token) {
        throw new Error(formatGoogleError(tokenData, `Token exchange failed (HTTP ${tokenResp.status}).`));
      }

      const channel = await fetchYouTubeChannelInfo(tokenData.access_token);
      const rawHandle = (channel.channelHandle || channel.channelTitle || "").trim();
      const autoHandle = rawHandle
        ? rawHandle.startsWith("@")
          ? rawHandle
          : `@${rawHandle.replace(/\s+/g, "")}`
        : "";

      store.youtube.accessToken = tokenData.access_token;
      if (tokenData.refresh_token) {
        store.youtube.refreshToken = tokenData.refresh_token;
      }
      store.youtube.expiryDate = Date.now() + (Number(tokenData.expires_in) || 3500) * 1000;
      store.youtube.channelId = channel.channelId;
      store.youtube.channelTitle = channel.channelTitle;
      store.youtube.channelHandle = autoHandle || channel.channelHandle;
      saveStore(store);

      if (autoHandle && typeof saveSettings === "function") {
        try {
          saveSettings({ handle: autoHandle });
        } catch {}
      }

      return {
        status: 200,
        html: renderCallbackHtml({
          ok: true,
          title: "YouTube channel connected",
          detail: `Connected to ${channel.channelTitle}${autoHandle ? ` (${autoHandle})` : ""}. You can return to Fivestar.`,
          channelTitle: channel.channelTitle,
          channelHandle: autoHandle,
          openerOrigin,
        }),
      };
    } catch (err) {
      return {
        status: 400,
        html: renderCallbackHtml({
          ok: false,
          title: "Could not connect YouTube",
          detail: err?.message || "Authorization failed.",
          openerOrigin,
        }),
      };
    }
  }

  let oauthServer = null;
  let oauthServerListening = false;
  let oauthCloseTimer = null;

  function closeOAuthCallbackServer() {
    if (oauthCloseTimer) {
      clearTimeout(oauthCloseTimer);
      oauthCloseTimer = null;
    }
    if (oauthServer) {
      try {
        oauthServer.close();
      } catch {}
      oauthServer = null;
    }
    oauthServerListening = false;
  }

  function scheduleOAuthClose(ms) {
    if (oauthCloseTimer) clearTimeout(oauthCloseTimer);
    oauthCloseTimer = setTimeout(() => closeOAuthCallbackServer(), ms);
    oauthCloseTimer.unref?.();
  }

  function ensureOAuthCallbackServer() {
    if (oauthServerListening && oauthServer) {
      scheduleOAuthClose(15 * 60_000);
      return Promise.resolve();
    }
    closeOAuthCallbackServer();
    return new Promise((resolve, reject) => {
      const srv = http.createServer(async (req, res) => {
        try {
          const parsed = new URL(req.url || "/", `http://${YT_CALLBACK_HOST}:${YT_CALLBACK_PORT}`);
          if (req.method === "GET" && parsed.pathname === YT_CALLBACK_PATH) {
            const query = Object.fromEntries(parsed.searchParams.entries());
            const result = await processYouTubeCallback(query);
            res.writeHead(result.status, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(result.html);
            scheduleOAuthClose(3000);
            return;
          }
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(err?.message || "Internal error");
        }
      });

      const onError = (err) => {
        oauthServerListening = false;
        oauthServer = null;
        reject(err);
      };
      srv.once("error", onError);
      srv.listen(YT_CALLBACK_PORT, YT_CALLBACK_HOST, () => {
        srv.removeListener("error", onError);
        srv.on("error", (err) => {
          console.error(`YouTube OAuth callback server error:`, err.message);
        });
        oauthServer = srv;
        oauthServerListening = true;
        scheduleOAuthClose(15 * 60_000);
        resolve();
      });
    });
  }

  // ---- Status ----
  app.get("/api/social/status", (req, res) => {
    const store = loadStore();
    const yt = store.youtube;
    if (
      yt.clientId &&
      yt.clientSecret &&
      (yt.refreshToken || yt.accessToken) &&
      yt.channelHandle &&
      typeof getSettings === "function" &&
      typeof saveSettings === "function"
    ) {
      try {
        const cur = getSettings();
        if (!cur?.handle) {
          saveSettings({ handle: yt.channelHandle });
        }
      } catch {}
    }
    res.json(publicStatus(req, store));
  });

  // ---- YouTube Config & OAuth ----
  app.put("/api/social/youtube/config", (req, res) => {
    const store = loadStore();
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const nextClientId = String(body.clientId ?? "").trim();
    const nextClientSecret = String(body.clientSecret ?? "").trim();

    if (nextClientId && nextClientId !== store.youtube.clientId) {
      store.youtube.accessToken = "";
      store.youtube.refreshToken = "";
      store.youtube.expiryDate = 0;
      store.youtube.channelId = "";
      store.youtube.channelTitle = "";
      store.youtube.channelHandle = "";
    }
    store.youtube.clientId = nextClientId;
    if (nextClientSecret) {
      store.youtube.clientSecret = nextClientSecret;
    } else if (body.clearSecret) {
      store.youtube.clientSecret = "";
    }
    saveStore(store);
    res.json(publicStatus(req, store));
  });

  app.post("/api/social/youtube/auth-url", async (req, res, next) => {
    try {
      const store = loadStore();
      const body = req.body && typeof req.body === "object" ? req.body : {};

      if (typeof body.clientId === "string" && body.clientId.trim()) {
        const incomingId = body.clientId.trim();
        if (incomingId !== store.youtube.clientId) {
          store.youtube.accessToken = "";
          store.youtube.refreshToken = "";
          store.youtube.expiryDate = 0;
          store.youtube.channelId = "";
          store.youtube.channelTitle = "";
          store.youtube.channelHandle = "";
        }
        store.youtube.clientId = incomingId;
      }
      if (typeof body.clientSecret === "string" && body.clientSecret.trim()) {
        store.youtube.clientSecret = body.clientSecret.trim();
      }
      saveStore(store);

      if (!store.youtube.clientId || !store.youtube.clientSecret) {
        throw makeError(400, "Enter both your YouTube OAuth Client ID and Client Secret first.");
      }

      try {
        await ensureOAuthCallbackServer();
      } catch (err) {
        throw makeError(
          500,
          `Could not listen on ${YT_REDIRECT_URI} (${err.code || err.message}). Make sure port ${YT_CALLBACK_PORT} is free.`
        );
      }

      const now = Date.now();
      for (const [k, v] of pendingStates) {
        if (now - v.createdAt > 15 * 60_000) pendingStates.delete(k);
      }

      const state = crypto.randomBytes(24).toString("hex");
      const redirectUri = getRedirectUri(req);
      const openerOrigin = req.get("origin") || getBaseUrl(req);
      pendingStates.set(state, { createdAt: now, redirectUri, openerOrigin });

      const params = new URLSearchParams({
        client_id: store.youtube.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: YT_SCOPES,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
      });

      res.json({
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        redirectUri,
      });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/youtube/callback", async (req, res) => {
    const result = await processYouTubeCallback(req.query || {});
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(result.status).send(result.html);
  });

  app.post("/api/social/youtube/disconnect", async (req, res) => {
    const store = loadStore();
    const tokenToRevoke = store.youtube.refreshToken || store.youtube.accessToken;
    if (tokenToRevoke) {
      fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
        method: "POST",
      }).catch(() => {});
    }
    store.youtube.accessToken = "";
    store.youtube.refreshToken = "";
    store.youtube.expiryDate = 0;
    store.youtube.channelId = "";
    store.youtube.channelTitle = "";
    store.youtube.channelHandle = "";
    if (req.body?.clearCredentials) {
      store.youtube.clientId = "";
      store.youtube.clientSecret = "";
    }
    saveStore(store);
    res.json(publicStatus(req, store));
  });

  // Background worker to re-apply custom 9:16 cover thumbnail once YouTube video transcoding completes
  async function ensureThumbnailAfterProcessing(videoId, thumbBuf, mime, store) {
    const maxChecks = 15; // 15 checks * 8s = 2 minutes max
    for (let i = 1; i <= maxChecks; i++) {
      await new Promise((r) => setTimeout(r, 8000));
      try {
        const token = await ensureYouTubeAccessToken(store);
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=processingDetails,status&id=${encodeURIComponent(videoId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) continue;
        const data = parseJsonSafe(await res.text());
        const proc = data?.items?.[0]?.processingDetails;
        const status = proc?.processingStatus;
        console.log(`[YouTube Thumbnail Watcher] Video ${videoId} processing status (${i}/${maxChecks}): ${status || "unknown"}`);
        if (status === "succeeded" || i === maxChecks) {
          // Video finished processing! Re-apply custom thumbnail so YouTube Shorts locks it in.
          const reResp = await fetch(
            `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": mime,
                "Content-Length": String(thumbBuf.length),
              },
              body: thumbBuf,
            }
          );
          if (reResp.ok) {
            console.log(`[YouTube Thumbnail Watcher] Successfully locked in custom Shorts cover thumbnail for video ${videoId} after processing completed.`);
          } else {
            console.warn(`[YouTube Thumbnail Watcher] Re-applying thumbnail returned HTTP ${reResp.status}`);
          }
          break;
        }
      } catch (e) {
        console.warn(`[YouTube Thumbnail Watcher] Notice:`, e.message);
      }
    }
  }

  // ---- YouTube Direct Upload ----
  app.post(
    "/api/projects/:id/clips/:clipId/upload/youtube",
    optionalMultipart,
    async (req, res, next) => {
      let resolved = null;
      try {
        const { p, clip } = getProjectAndClip(req);
        const store = loadStore();
        const accessToken = await ensureYouTubeAccessToken(store);
        resolved = await resolveClipVideoFile(req, p, clip);

        const body = req.body && typeof req.body === "object" ? req.body : {};
        const rawTitle = String(body.title ?? clip.meta?.title ?? "").trim();
        if (!rawTitle) {
          throw makeError(400, "Enter a Title before uploading to YouTube.");
        }
        const title = rawTitle.slice(0, 100);
        const description = String(body.description ?? clip.meta?.description ?? "").slice(0, 5000);
        const tags = cleanYouTubeTags(body.hashtags ?? clip.meta?.hashtags ?? []);
        const allowedCategories = new Set([
          "1", "2", "10", "15", "17", "19", "20", "22", "23", "24", "25", "26", "27", "28", "29",
        ]);
        const rawCategory = String(body.categoryId ?? "20").trim();
        const categoryId = allowedCategories.has(rawCategory) ? rawCategory : "20";
        const rawLang = String(body.defaultLanguage ?? "").trim();
        const defaultLanguage = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(rawLang) ? rawLang : "";
        const rawPrivacy = String(body.privacyStatus ?? "public").toLowerCase();
        let privacyStatus = ["private", "unlisted", "public"].includes(rawPrivacy)
          ? rawPrivacy
          : "public";
        const madeForKids = body.madeForKids === true || body.madeForKids === "true";

        let publishAt = "";
        if (typeof body.publishAt === "string" && body.publishAt.trim()) {
          const parsedDate = new Date(body.publishAt.trim());
          if (!Number.isFinite(parsedDate.getTime())) {
            throw makeError(400, "Invalid scheduled publish date/time.");
          }
          if (parsedDate.getTime() <= Date.now() + 30_000) {
            throw makeError(400, "Scheduled publish time must be in the future.");
          }
          publishAt = parsedDate.toISOString();
          privacyStatus = "private";
        }

        const metadata = {
          snippet: {
            title,
            description,
            categoryId,
            ...(tags.length ? { tags } : {}),
            ...(defaultLanguage
              ? { defaultLanguage, defaultAudioLanguage: defaultLanguage }
              : {}),
          },
          status: {
            privacyStatus,
            selfDeclaredMadeForKids: madeForKids,
            ...(publishAt ? { publishAt } : {}),
          },
        };

        // Step 1: Initiate resumable upload session
        const initResp = await fetch(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json; charset=UTF-8",
              "X-Upload-Content-Length": String(resolved.size),
              "X-Upload-Content-Type": "video/mp4",
            },
            body: JSON.stringify(metadata),
          }
        );

        const uploadUrl = initResp.headers.get("location");
        if (!initResp.ok || !uploadUrl) {
          const errData = parseJsonSafe(await initResp.text());
          throw makeError(
            initResp.status || 500,
            formatGoogleError(errData, `Could not start YouTube upload (HTTP ${initResp.status}).`)
          );
        }

        // Step 2: Stream MP4 file directly to Google's upload URI
        const putResp = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": String(resolved.size),
          },
          body: fs.createReadStream(resolved.filePath),
          duplex: "half",
        });

        const putData = parseJsonSafe(await putResp.text());
        if (!putResp.ok || !putData?.id) {
          throw makeError(
            putResp.status || 500,
            formatGoogleError(putData, `YouTube rejected the video upload (HTTP ${putResp.status}).`)
          );
        }

        // Step 3 (optional): Upload Cover image as custom thumbnail
        let thumbnailUploaded = false;
        let thumbnailWarning = "";
        const wantThumb = body.uploadThumbnail !== false && body.uploadThumbnail !== "false";
        const thumbDataUrl = typeof body.thumbnailDataUrl === "string" ? body.thumbnailDataUrl.trim() : "";
        if (wantThumb && thumbDataUrl) {
          const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(thumbDataUrl);
          if (match) {
            const mime = match[1];
            const thumbBuf = Buffer.from(match[2], "base64");
            if (thumbBuf.length > 0 && thumbBuf.length <= 2 * 1024 * 1024) {
              // Persist cover.jpg in clip folder
              try {
                fs.writeFileSync(path.join(projectDir(p.id), "clips", clip.id, "cover.jpg"), thumbBuf);
              } catch {}

              try {
                const thumbResp = await fetch(
                  `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(putData.id)}&uploadType=media`,
                  {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      "Content-Type": mime,
                      "Content-Length": String(thumbBuf.length),
                    },
                    body: thumbBuf,
                  }
                );
                if (thumbResp.ok) {
                  thumbnailUploaded = true;
                  // Start background watcher to re-apply custom 9:16 thumbnail once YouTube video transcoding finishes
                  ensureThumbnailAfterProcessing(putData.id, thumbBuf, mime, store);
                } else {
                  const thumbErr = parseJsonSafe(await thumbResp.text());
                  thumbnailWarning = formatGoogleError(
                    thumbErr,
                    `Cover thumbnail skipped (HTTP ${thumbResp.status}; channel may need phone verification or YouTube Studio for Shorts thumbnails).`
                  );
                }
              } catch (err) {
                thumbnailWarning = `Cover thumbnail could not be uploaded: ${err.message}`;
              }
            } else if (thumbBuf.length > 2 * 1024 * 1024) {
              thumbnailWarning = "Cover image exceeded YouTube's 2 MB thumbnail limit and was skipped.";
            }
          }
        }

        const result = {
          ok: true,
          videoId: putData.id,
          url: `https://youtube.com/shorts/${putData.id}`,
          watchUrl: `https://www.youtube.com/watch?v=${putData.id}`,
          studioUrl: `https://studio.youtube.com/video/${putData.id}/edit`,
          privacyStatus: putData.status?.privacyStatus || privacyStatus,
          publishAt: putData.status?.publishAt || publishAt || "",
          categoryId,
          madeForKids,
          thumbnailUploaded,
          thumbnailWarning,
          channelTitle: store.youtube.channelTitle || "",
          at: Date.now(),
        };

        clip.youtubeUpload = result;
        saveProject(p, true);
        res.json(result);
      } catch (err) {
        next(err);
      } finally {
        if (resolved?.cleanup && resolved.filePath) {
          fs.rmSync(resolved.filePath, { force: true });
        }
      }
    }
  );

  // ---- YouTube Re-apply / Set Cover Thumbnail Endpoint ----
  app.post(
    "/api/projects/:id/clips/:clipId/upload/youtube/thumbnail",
    optionalMultipart,
    async (req, res, next) => {
      try {
        const { p, clip } = getProjectAndClip(req);
        const videoId = String(req.body?.videoId || clip.youtubeUpload?.videoId || "").trim();
        if (!videoId) {
          return res.status(400).json({ error: "This clip has not been uploaded to YouTube yet (no videoId found)." });
        }

        const store = loadStore();
        const accessToken = await ensureYouTubeAccessToken(store);

        let thumbBuf = null;
        let mime = "image/jpeg";

        const thumbDataUrl = typeof req.body?.thumbnailDataUrl === "string" ? req.body.thumbnailDataUrl.trim() : "";
        if (thumbDataUrl) {
          const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(thumbDataUrl);
          if (match) {
            mime = match[1];
            thumbBuf = Buffer.from(match[2], "base64");
          }
        }

        // Fallback to cover.jpg, thumb-*.jpg or poster.jpg on disk
        if (!thumbBuf) {
          const cDir = path.join(projectDir(p.id), "clips", clip.id);
          const coverPath = path.join(cDir, "cover.jpg");
          if (fs.existsSync(coverPath)) {
            thumbBuf = fs.readFileSync(coverPath);
          } else if (fs.existsSync(cDir)) {
            const files = fs.readdirSync(cDir);
            const thumbFile = files.find(f => f.startsWith("thumb-") && f.endsWith(".jpg"));
            if (thumbFile) {
              thumbBuf = fs.readFileSync(path.join(cDir, thumbFile));
            } else if (fs.existsSync(path.join(cDir, "poster.jpg"))) {
              thumbBuf = fs.readFileSync(path.join(cDir, "poster.jpg"));
            }
          }
        }

        if (!thumbBuf || thumbBuf.length === 0) {
          return res.status(400).json({ error: "No Cover image found to upload. Please ensure a Cover frame is selected." });
        }

        if (thumbBuf.length > 2 * 1024 * 1024) {
          return res.status(400).json({ error: "Cover image exceeds YouTube's 2 MB limit." });
        }

        // Save cover.jpg for persistence
        try {
          fs.writeFileSync(path.join(projectDir(p.id), "clips", clip.id, "cover.jpg"), thumbBuf);
        } catch {}

        const thumbResp = await fetch(
          `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": mime,
              "Content-Length": String(thumbBuf.length),
            },
            body: thumbBuf,
          }
        );

        if (!thumbResp.ok) {
          const thumbErr = parseJsonSafe(await thumbResp.text());
          throw new Error(formatGoogleError(thumbErr, `YouTube returned HTTP ${thumbResp.status}`));
        }

        const thumbData = parseJsonSafe(await thumbResp.text());
        if (clip.youtubeUpload) {
          clip.youtubeUpload.thumbnailUploaded = true;
          clip.youtubeUpload.thumbnailWarning = "";
          saveProject(p, true);
        }

        return res.json({
          ok: true,
          videoId,
          message: "Cover image successfully set as YouTube Shorts thumbnail!",
          thumbnail: thumbData
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ---- Instagram Config & Token Refresh ----
  app.put("/api/social/instagram/config", async (req, res, next) => {
    try {
      const store = loadStore();
      const body = req.body && typeof req.body === "object" ? req.body : {};
      let igUserId = String(body.igUserId ?? store.instagram.igUserId ?? "").trim();
      const accessToken = String(body.accessToken ?? "").trim() || store.instagram.accessToken;
      const appId = String(body.appId ?? store.instagram.appId ?? "").trim();
      const appSecret = String(body.appSecret ?? "").trim() || store.instagram.appSecret;

      if (!accessToken) {
        throw makeError(400, "Enter your Instagram Graph API Access Token.");
      }

      let username = "";
      let name = "";

      // If IG User ID is blank, try auto-discovering via linked Facebook Pages
      if (!igUserId) {
        const pagesResp = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=name,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(accessToken)}`
        );
        const pagesData = parseJsonSafe(await pagesResp.text());
        if (!pagesResp.ok) {
          throw makeError(
            pagesResp.status,
            formatMetaError(
              pagesData,
              "Could not auto-detect your Instagram Business/Creator account. Paste your Instagram User ID directly."
            )
          );
        }
        const match = (pagesData?.data || []).find((pg) => pg.instagram_business_account?.id);
        if (!match) {
          throw makeError(
            400,
            "No Instagram Business or Creator account linked to a Facebook Page was found for this token. Enter your Instagram User ID manually or link your account to a Facebook Page."
          );
        }
        igUserId = match.instagram_business_account.id;
        username = match.instagram_business_account.username || "";
        name = match.instagram_business_account.name || "";
      } else {
        // Verify provided IG User ID + token
        const verifyResp = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(igUserId)}?fields=id,username,name&access_token=${encodeURIComponent(accessToken)}`
        );
        const verifyData = parseJsonSafe(await verifyResp.text());
        if (!verifyResp.ok || !verifyData?.id) {
          throw makeError(
            verifyResp.status || 400,
            formatMetaError(verifyData, "Could not verify Instagram User ID and Access Token.")
          );
        }
        igUserId = verifyData.id;
        username = verifyData.username || "";
        name = verifyData.name || "";
      }

      store.instagram = {
        igUserId,
        accessToken,
        appId,
        appSecret,
        username,
        name,
        tokenExpiresAt: store.instagram.tokenExpiresAt || 0,
      };
      saveStore(store);
      res.json(publicStatus(req, store));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/social/instagram/refresh", async (req, res, next) => {
    try {
      const store = loadStore();
      const ig = store.instagram;
      if (!ig.accessToken) {
        throw makeError(400, "Save an Instagram Access Token first.");
      }
      if (!ig.appId || !ig.appSecret) {
        throw makeError(400, "Enter your Meta App ID and App Secret to exchange/extend the token.");
      }

      const params = new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: ig.appId,
        client_secret: ig.appSecret,
        fb_exchange_token: ig.accessToken,
      });
      const resp = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${params.toString()}`
      );
      const data = parseJsonSafe(await resp.text());
      if (!resp.ok || !data?.access_token) {
        throw makeError(
          resp.status || 400,
          formatMetaError(data, "Could not extend Instagram token.")
        );
      }

      ig.accessToken = data.access_token;
      ig.tokenExpiresAt = data.expires_in
        ? Date.now() + Number(data.expires_in) * 1000
        : Date.now() + 60 * 24 * 3600 * 1000;
      saveStore(store);
      res.json(publicStatus(req, store));
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/social/instagram/disconnect", (req, res) => {
    const store = loadStore();
    store.instagram = { ...DEFAULT_STORE.instagram };
    saveStore(store);
    res.json(publicStatus(req, store));
  });

  // ---- Reveal Clip Video File in Windows Explorer / macOS Finder ----
  app.post(
    "/api/projects/:id/clips/:clipId/reveal-file",
    async (req, res, next) => {
      try {
        const { p, clip } = getProjectAndClip(req);
        const pDir = projectDir(p.id);
        const cDir = path.join(pDir, "clips", clip.id);

        let targetPath = "";
        if (clip.output?.file && clip.output.file !== "local") {
          const exportPath = path.resolve(pDir, clip.output.file);
          if (fs.existsSync(exportPath)) targetPath = exportPath;
        }

        if (!targetPath) {
          const srcPath = path.join(cDir, "src.mp4");
          if (fs.existsSync(srcPath)) {
            targetPath = srcPath;
          } else if (fs.existsSync(cDir)) {
            targetPath = cDir;
          } else if (fs.existsSync(pDir)) {
            targetPath = pDir;
          }
        }

        if (!targetPath) {
          return res.status(404).json({ error: "Clip folder or video file not found on disk." });
        }

        if (process.platform === "win32") {
          if (fs.statSync(targetPath).isDirectory()) {
            spawn("explorer.exe", [targetPath], { detached: true, stdio: "ignore" }).unref();
          } else {
            spawn("explorer.exe", ["/select,", targetPath], { detached: true, stdio: "ignore" }).unref();
          }
        } else if (process.platform === "darwin") {
          spawn("open", ["-R", targetPath], { detached: true, stdio: "ignore" }).unref();
        } else {
          const openDir = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
          spawn("xdg-open", [openDir], { detached: true, stdio: "ignore" }).unref();
        }

        return res.json({ ok: true, path: targetPath });
      } catch (err) {
        next(err);
      }
    }
  );

  // ---- Instagram Reels Direct Upload (Resumable Binary Flow) ----
  app.post(
    "/api/projects/:id/clips/:clipId/upload/instagram",
    optionalMultipart,
    async (req, res, next) => {
      let resolved = null;
      try {
        const { p, clip } = getProjectAndClip(req);
        const store = loadStore();
        const ig = store.instagram;

        if (!ig.accessToken || !ig.igUserId) {
          throw makeError(400, "Connect your Instagram Business/Creator account in Settings first.");
        }

        resolved = await resolveClipVideoFile(req, p, clip);
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const caption = String(body.caption ?? clip.meta?.instagramCaption ?? "").slice(0, 2200);
        const shareToFeed = body.shareToFeed === false || body.shareToFeed === "false" ? "false" : "true";
        const rawOffset = Number(body.thumbOffsetMs);
        const thumbOffsetMs =
          Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.round(rawOffset) : null;

        // Step 1: Create resumable REELS media container
        const createParams = new URLSearchParams({
          media_type: "REELS",
          upload_type: "resumable",
          caption,
          share_to_feed: shareToFeed,
          ...(thumbOffsetMs !== null ? { thumb_offset: String(thumbOffsetMs) } : {}),
          access_token: ig.accessToken,
        });
        const createResp = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(ig.igUserId)}/media`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: createParams,
          }
        );
        const createData = parseJsonSafe(await createResp.text());
        if (!createResp.ok || !createData?.id) {
          throw makeError(
            createResp.status || 500,
            formatMetaError(createData, `Could not create Instagram Reel upload session (HTTP ${createResp.status}).`)
          );
        }

        const containerId = createData.id;
        const uploadUri =
          createData.uri || `https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}/${containerId}`;

        // Step 2: Stream local MP4 binary directly to rupload.facebook.com
        const uploadResp = await fetch(uploadUri, {
          method: "POST",
          headers: {
            Authorization: `OAuth ${ig.accessToken}`,
            offset: "0",
            file_size: String(resolved.size),
            "Content-Type": "application/octet-stream",
            "Content-Length": String(resolved.size),
          },
          body: fs.createReadStream(resolved.filePath),
          duplex: "half",
        });
        const uploadData = parseJsonSafe(await uploadResp.text());
        if (!uploadResp.ok || uploadData?.error || uploadData?.success === false) {
          throw makeError(
            uploadResp.status || 500,
            formatMetaError(uploadData, `Instagram rejected the MP4 binary upload (HTTP ${uploadResp.status}).`)
          );
        }

        // Step 3: Poll container until Meta finishes video processing
        let statusCode = "IN_PROGRESS";
        let lastStatusText = "";
        for (let attempt = 0; attempt < 60; attempt++) {
          await sleep(attempt === 0 ? 2000 : 3000);
          const pollResp = await fetch(
            `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(ig.accessToken)}`
          );
          const pollData = parseJsonSafe(await pollResp.text());
          if (!pollResp.ok) {
            throw makeError(
              pollResp.status || 500,
              formatMetaError(pollData, "Failed while checking Instagram processing status.")
            );
          }
          statusCode = pollData?.status_code || "IN_PROGRESS";
          lastStatusText = pollData?.status || "";
          if (statusCode === "FINISHED" || statusCode === "PUBLISHED") break;
          if (statusCode === "ERROR" || statusCode === "EXPIRED") {
            throw makeError(
              400,
              `Instagram could not process this Reel (${statusCode}${lastStatusText ? `: ${lastStatusText}` : ""}).`
            );
          }
        }

        if (statusCode !== "FINISHED" && statusCode !== "PUBLISHED") {
          throw makeError(504, "Instagram took too long to process the video. Try again in a moment.");
        }

        // Step 4: Publish the processed container
        const pubParams = new URLSearchParams({
          creation_id: containerId,
          access_token: ig.accessToken,
        });
        const pubResp = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(ig.igUserId)}/media_publish`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: pubParams,
          }
        );
        const pubData = parseJsonSafe(await pubResp.text());
        if (!pubResp.ok || !pubData?.id) {
          throw makeError(
            pubResp.status || 500,
            formatMetaError(pubData, `Could not publish Instagram Reel (HTTP ${pubResp.status}).`)
          );
        }

        // Step 5: Best-effort permalink lookup
        let permalink = "";
        try {
          const linkResp = await fetch(
            `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pubData.id)}?fields=permalink&access_token=${encodeURIComponent(ig.accessToken)}`
          );
          const linkData = parseJsonSafe(await linkResp.text());
          if (linkResp.ok && linkData?.permalink) {
            permalink = linkData.permalink;
          }
        } catch {}

        const result = {
          ok: true,
          mediaId: pubData.id,
          permalink,
          username: ig.username || "",
          at: Date.now(),
        };

        clip.instagramUpload = result;
        saveProject(p, true);
        res.json(result);
      } catch (err) {
        next(err);
      } finally {
        if (resolved?.cleanup && resolved.filePath) {
          fs.rmSync(resolved.filePath, { force: true });
        }
      }
    }
  );
}
