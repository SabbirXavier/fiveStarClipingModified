// Social direct-upload UI components for Fivestar (YouTube Data API v3 + Instagram Graph API)

const SOCIAL_EVENT = "fivestar-social-updated";

const YT_CATEGORIES = [
  { id: "20", label: "Gaming" },
  { id: "24", label: "Entertainment" },
  { id: "22", label: "People & Blogs" },
  { id: "23", label: "Comedy" },
  { id: "10", label: "Music" },
  { id: "17", label: "Sports" },
  { id: "27", label: "Education" },
  { id: "28", label: "Science & Technology" },
  { id: "25", label: "News & Politics" },
  { id: "26", label: "Howto & Style" },
  { id: "1", label: "Film & Animation" },
];

const YT_LANGUAGES = [
  { code: "", label: "Auto / Not set" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "ar", label: "Arabic" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

async function apiJson(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!resp.ok) {
    throw new Error(data?.error || `Request failed (HTTP ${resp.status})`);
  }
  return data;
}

function notifySocialUpdated(status) {
  window.dispatchEvent(new CustomEvent(SOCIAL_EVENT, { detail: status || null }));
}

function openSettingsModal() {
  const btn = document.querySelector('button[aria-label="Settings"]');
  if (btn) btn.click();
}

function captureCoverDataUrl() {
  try {
    const canvas =
      document.querySelector(".cover-preview canvas") ||
      document.querySelector(".cover-maker canvas") ||
      document.querySelector(".cover-group canvas");
    if (!canvas || !canvas.width || !canvas.height) return "";
    let dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    if (dataUrl.length > 2_000_000) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    }
    return dataUrl;
  } catch {
    return "";
  }
}

export function createSocialComponents({ React, jsx, jsxs, Fragment, icons, toast, copyText }) {
  const { useState, useEffect, useRef } = React;
  const { Upload, Check, Error: ErrorIcon, Spinner, External, Copy, Refresh } = icons;

  function useSocialStatus() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    const refresh = async () => {
      try {
        const data = await apiJson("/api/social/status");
        setStatus(data);
        return data;
      } catch {
        return null;
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      refresh();
      const onUpdated = (ev) => {
        if (ev.detail) setStatus(ev.detail);
        else refresh();
      };
      const onFocus = () => refresh();
      window.addEventListener(SOCIAL_EVENT, onUpdated);
      window.addEventListener("focus", onFocus);
      return () => {
        window.removeEventListener(SOCIAL_EVENT, onUpdated);
        window.removeEventListener("focus", onFocus);
      };
    }, []);

    return { status, setStatus, loading, refresh };
  }

  function SocialSettingsSection({ onYouTubeConnected, onInstagramConnected } = {}) {
    const { status, setStatus, refresh } = useSocialStatus();

    const [ytClientId, setYtClientId] = useState("");
    const [ytClientSecret, setYtClientSecret] = useState("");
    const [ytBusy, setYtBusy] = useState(false);

    const [igUserId, setIgUserId] = useState("");
    const [igAccessToken, setIgAccessToken] = useState("");
    const [igAppId, setIgAppId] = useState("");
    const [igAppSecret, setIgAppSecret] = useState("");
    const [igBusy, setIgBusy] = useState(false);
    const initialized = useRef(false);
    const onConnectedRef = useRef(onYouTubeConnected);
    onConnectedRef.current = onYouTubeConnected;
    const onIgConnectedRef = useRef(onInstagramConnected);
    onIgConnectedRef.current = onInstagramConnected;

    useEffect(() => {
      if (!status || initialized.current) return;
      initialized.current = true;
      setYtClientId(status.youtube?.clientId || "");
      setIgUserId(status.instagram?.igUserId || "");
      setIgAppId(status.instagram?.appId || "");
      if (
        status.youtube?.connected &&
        status.youtube?.channelHandle &&
        typeof onConnectedRef.current === "function"
      ) {
        onConnectedRef.current(status.youtube.channelHandle, { onlyIfEmpty: true });
      }
      if (
        status.instagram?.connected &&
        status.instagram?.username &&
        typeof onIgConnectedRef.current === "function"
      ) {
        onIgConnectedRef.current(status.instagram.username, { onlyIfEmpty: true });
      }
    }, [status]);

    useEffect(() => {
      const allowedOrigins = new Set([window.location.origin, "http://127.0.0.1:8765"]);
      const onMsg = async (ev) => {
        if (!allowedOrigins.has(ev.origin)) return;
        if (ev.data?.type !== "fivestar-youtube-auth") return;
        setYtBusy(false);
        const latest = await refresh();
        if (latest) notifySocialUpdated(latest);
        if (ev.data.ok) {
          const handle = ev.data.channelHandle || latest?.youtube?.channelHandle || "";
          if (handle && typeof onConnectedRef.current === "function") {
            onConnectedRef.current(handle);
          }
          toast(
            `Connected YouTube: ${ev.data.channelTitle || "Ready"}${handle ? ` (${handle})` : ""}`
          );
        } else {
          toast(ev.data.error || "YouTube sign-in failed", true);
        }
      };
      window.addEventListener("message", onMsg);
      return () => window.removeEventListener("message", onMsg);
    }, []);

    const yt = status?.youtube || {};
    const ig = status?.instagram || {};
    const redirectUri = yt.redirectUri || "http://127.0.0.1:8765/oauth/youtube/callback";

    const connectYouTube = async () => {
      setYtBusy(true);
      try {
        const res = await apiJson("/api/social/youtube/auth-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: ytClientId.trim(),
            clientSecret: ytClientSecret.trim(),
          }),
        });
        setYtClientSecret("");
        const popup = window.open(
          res.url,
          "fivestar-youtube-oauth",
          "width=560,height=700,noopener=no"
        );
        if (!popup) {
          window.open(res.url, "_blank");
          toast("Opened Google sign-in in a new tab. Finish sign-in, then return here.");
          setYtBusy(false);
        }
      } catch (err) {
        setYtBusy(false);
        toast(err.message, true);
      }
    };

    const saveYouTubeConfig = async () => {
      setYtBusy(true);
      try {
        const next = await apiJson("/api/social/youtube/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: ytClientId.trim(),
            clientSecret: ytClientSecret.trim(),
          }),
        });
        setYtClientSecret("");
        setStatus(next);
        notifySocialUpdated(next);
        toast("YouTube OAuth credentials saved");
      } catch (err) {
        toast(err.message, true);
      } finally {
        setYtBusy(false);
      }
    };

    const disconnectYouTube = async () => {
      setYtBusy(true);
      try {
        const next = await apiJson("/api/social/youtube/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        setStatus(next);
        notifySocialUpdated(next);
        toast("YouTube channel disconnected");
      } catch (err) {
        toast(err.message, true);
      } finally {
        setYtBusy(false);
      }
    };

    const saveInstagram = async () => {
      setIgBusy(true);
      try {
        const next = await apiJson("/api/social/instagram/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            igUserId: igUserId.trim(),
            accessToken: igAccessToken.trim(),
            appId: igAppId.trim(),
            appSecret: igAppSecret.trim(),
          }),
        });
        setIgAccessToken("");
        setIgAppSecret("");
        setIgUserId(next.instagram?.igUserId || igUserId);
        setStatus(next);
        notifySocialUpdated(next);
        if (next.instagram?.username && typeof onIgConnectedRef.current === "function") {
          onIgConnectedRef.current(next.instagram.username);
        }
        toast(
          next.instagram?.username
            ? `Instagram connected: @${next.instagram.username}`
            : "Instagram account connected"
        );
      } catch (err) {
        toast(err.message, true);
      } finally {
        setIgBusy(false);
      }
    };

    const refreshInstagramToken = async () => {
      setIgBusy(true);
      try {
        const next = await apiJson("/api/social/instagram/refresh", { method: "POST" });
        setStatus(next);
        notifySocialUpdated(next);
        toast("Instagram token extended (~60 days)");
      } catch (err) {
        toast(err.message, true);
      } finally {
        setIgBusy(false);
      }
    };

    const disconnectInstagram = async () => {
      setIgBusy(true);
      try {
        const next = await apiJson("/api/social/instagram/disconnect", { method: "POST" });
        setIgUserId("");
        setIgAccessToken("");
        setIgAppId("");
        setIgAppSecret("");
        setStatus(next);
        notifySocialUpdated(next);
        toast("Instagram account disconnected");
      } catch (err) {
        toast(err.message, true);
      } finally {
        setIgBusy(false);
      }
    };

    const sectionStyle = {
      borderTop: "1px solid var(--line)",
      paddingTop: 18,
      marginTop: 6,
      display: "flex",
      flexDirection: "column",
      gap: 12,
    };

    return jsxs(Fragment, {
      children: [
        // ---- YouTube OAuth Section ----
        jsxs("div", {
          style: sectionStyle,
          children: [
            jsxs("div", {
              className: "row-between",
              children: [
                jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: 10 },
                  children: [
                    jsx("strong", { style: { fontSize: 15 }, children: "YouTube direct upload (API v3)" }),
                    jsx("a", {
                      href: "/youtube-guide.html",
                      target: "_blank",
                      rel: "noreferrer",
                      className: "btn btn-small",
                      style: { fontSize: 11.5, padding: "2px 8px", textDecoration: "none" },
                      children: "📖 Setup Guide ↗",
                    }),
                  ],
                }),
                yt.connected
                  ? jsxs("span", {
                      className: "status status-good",
                      children: [
                        jsx(Check, { size: 15 }),
                        yt.channelTitle || "Connected",
                        yt.channelHandle ? ` (${yt.channelHandle})` : "",
                      ],
                    })
                  : jsx("span", { className: "note", children: "Not connected" }),
              ],
            }),
            jsxs("div", {
              className: "field",
              children: [
                jsx("label", { htmlFor: "set-yt-client-id", children: "YouTube OAuth Client ID" }),
                jsx("input", {
                  id: "set-yt-client-id",
                  className: "input",
                  placeholder: "1234567890-xxxx.apps.googleusercontent.com",
                  value: ytClientId,
                  onChange: (e) => setYtClientId(e.target.value),
                  autoComplete: "off",
                }),
              ],
            }),
            jsxs("div", {
              className: "field",
              children: [
                jsx("label", {
                  htmlFor: "set-yt-client-secret",
                  children: "YouTube OAuth Client Secret",
                }),
                jsx("input", {
                  id: "set-yt-client-secret",
                  className: "input",
                  type: "password",
                  placeholder: yt.hasClientSecret
                    ? "Saved — leave blank to keep existing secret"
                    : "GOCSPX-...",
                  value: ytClientSecret,
                  onChange: (e) => setYtClientSecret(e.target.value),
                  autoComplete: "new-password",
                }),
              ],
            }),
            jsxs("div", {
              className: "field",
              children: [
                jsxs("div", {
                  className: "row-between",
                  children: [
                    jsx("span", { className: "label", children: "Authorized redirect URI" }),
                    jsxs("button", {
                      type: "button",
                      className: "btn btn-small",
                      onClick: async () =>
                        toast(
                          (await copyText(redirectUri))
                            ? "Redirect URI copied"
                            : "Could not copy redirect URI"
                        ),
                      children: [jsx(Copy, { size: 13 }), "Copy"],
                    }),
                  ],
                }),
                jsx("input", {
                  className: "input",
                  value: redirectUri,
                  readOnly: true,
                  onFocus: (e) => e.target.select(),
                }),
                jsx("span", {
                  className: "note",
                  children:
                    "In Google Cloud Console, enable YouTube Data API v3, create an OAuth 2.0 Web Client, and add this exact redirect URI. Connecting automatically fills Your channel handle above.",
                }),
              ],
            }),
            jsxs("div", {
              className: "row",
              style: { flexWrap: "wrap", gap: 8 },
              children: [
                jsxs("button", {
                  type: "button",
                  className: "btn btn-primary btn-small",
                  disabled: ytBusy || !ytClientId.trim() || (!ytClientSecret.trim() && !yt.hasClientSecret),
                  onClick: connectYouTube,
                  children: [
                    ytBusy ? jsx(Spinner, { size: 14 }) : jsx(Upload, { size: 14 }),
                    yt.connected ? "Reconnect YouTube channel" : "Connect YouTube channel",
                  ],
                }),
                jsx("button", {
                  type: "button",
                  className: "btn btn-small",
                  disabled: ytBusy || !ytClientId.trim(),
                  onClick: saveYouTubeConfig,
                  children: "Save keys",
                }),
                yt.connected &&
                  jsx("button", {
                    type: "button",
                    className: "btn btn-small",
                    disabled: ytBusy,
                    onClick: disconnectYouTube,
                    children: "Disconnect",
                  }),
              ],
            }),
          ],
        }),

        // ---- Instagram Graph API Section ----
        jsxs("div", {
          style: sectionStyle,
          children: [
            jsxs("div", {
              className: "row-between",
              children: [
                jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: 10 },
                  children: [
                    jsx("strong", { style: { fontSize: 15 }, children: "Instagram Reels direct upload (Graph API)" }),
                    jsx("a", {
                      href: "/instagram-guide.html",
                      target: "_blank",
                      rel: "noreferrer",
                      className: "btn btn-small",
                      style: { fontSize: 11.5, padding: "2px 8px", textDecoration: "none" },
                      children: "📖 Setup Guide ↗",
                    }),
                  ],
                }),
                ig.connected
                  ? jsxs("span", {
                      className: "status status-good",
                      children: [
                        jsx(Check, { size: 15 }),
                        ig.username ? `@${ig.username}` : `ID ${ig.igUserId}`,
                      ],
                    })
                  : jsx("span", { className: "note", children: "Not connected" }),
              ],
            }),
            jsxs("div", {
              className: "field",
              children: [
                jsx("label", {
                  htmlFor: "set-ig-token",
                  children: "Meta Graph API Access Token",
                }),
                jsx("input", {
                  id: "set-ig-token",
                  className: "input",
                  type: "password",
                  placeholder: ig.hasAccessToken
                    ? "Saved — leave blank to keep existing token"
                    : "EAA...",
                  value: igAccessToken,
                  onChange: (e) => setIgAccessToken(e.target.value),
                  autoComplete: "new-password",
                }),
              ],
            }),
            jsxs("div", {
              className: "field",
              children: [
                jsx("label", {
                  htmlFor: "set-ig-user-id",
                  children: "Instagram Business/Creator User ID (optional)",
                }),
                jsx("input", {
                  id: "set-ig-user-id",
                  className: "input",
                  placeholder: "Leave blank to auto-detect from linked Facebook Page",
                  value: igUserId,
                  onChange: (e) => setIgUserId(e.target.value),
                  autoComplete: "off",
                }),
              ],
            }),
            jsxs("div", {
              className: "row",
              style: { alignItems: "flex-end" },
              children: [
                jsxs("div", {
                  className: "field grow",
                  children: [
                    jsx("label", { htmlFor: "set-ig-appid", children: "Meta App ID (optional)" }),
                    jsx("input", {
                      id: "set-ig-appid",
                      className: "input",
                      placeholder: "For 60-day token refresh",
                      value: igAppId,
                      onChange: (e) => setIgAppId(e.target.value),
                      autoComplete: "off",
                    }),
                  ],
                }),
                jsxs("div", {
                  className: "field grow",
                  children: [
                    jsx("label", { htmlFor: "set-ig-secret", children: "Meta App Secret (optional)" }),
                    jsx("input", {
                      id: "set-ig-secret",
                      className: "input",
                      type: "password",
                      placeholder: ig.hasAppSecret ? "Saved" : "Optional",
                      value: igAppSecret,
                      onChange: (e) => setIgAppSecret(e.target.value),
                      autoComplete: "new-password",
                    }),
                  ],
                }),
              ],
            }),
            jsx("span", {
              className: "note",
              children:
                "Needs a Business or Creator Instagram account linked to a Facebook Page, using Facebook Login for Business with instagram_basic and instagram_content_publish permissions.",
            }),
            jsxs("div", {
              className: "row",
              style: { flexWrap: "wrap", gap: 8 },
              children: [
                jsxs("button", {
                  type: "button",
                  className: "btn btn-primary btn-small",
                  disabled: igBusy || (!igAccessToken.trim() && !ig.hasAccessToken),
                  onClick: saveInstagram,
                  children: [
                    igBusy ? jsx(Spinner, { size: 14 }) : jsx(Upload, { size: 14 }),
                    ig.connected ? "Update & verify Instagram" : "Save & connect Instagram",
                  ],
                }),
                ig.connected &&
                  (ig.appId || igAppId.trim()) &&
                  (ig.hasAppSecret || igAppSecret.trim()) &&
                  jsxs("button", {
                    type: "button",
                    className: "btn btn-small",
                    disabled: igBusy,
                    onClick: refreshInstagramToken,
                    children: [jsx(Refresh, { size: 13 }), "Extend token (60d)"],
                  }),
                ig.connected &&
                  jsx("button", {
                    type: "button",
                    className: "btn btn-small",
                    disabled: igBusy,
                    onClick: disconnectInstagram,
                    children: "Disconnect",
                  }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  function YouTubeUploadBox({ project, clip, draft, meta }) {
    const { status } = useSocialStatus();
    const [privacy, setPrivacy] = useState(() => {
      try {
        return localStorage.getItem("fivestar_yt_privacy") || "public";
      } catch {
        return "public";
      }
    });
    const [categoryId, setCategoryId] = useState(() => {
      try {
        return localStorage.getItem("fivestar_yt_categoryId") || "20";
      } catch {
        return "20";
      }
    });
    const [madeForKids, setMadeForKids] = useState(() => {
      try {
        const v = localStorage.getItem("fivestar_yt_madeForKids");
        return v !== null ? v === "true" : false;
      } catch {
        return false;
      }
    });
    const [defaultLanguage, setDefaultLanguage] = useState(() => {
      try {
        return localStorage.getItem("fivestar_yt_language") ?? "";
      } catch {
        return "";
      }
    });
    const [publishAtLocal, setPublishAtLocal] = useState("");
    const [uploadThumbnail, setUploadThumbnail] = useState(() => {
      try {
        const v = localStorage.getItem("fivestar_yt_thumbnail");
        return v !== null ? v === "true" : true;
      } catch {
        return true;
      }
    });
    const [uploading, setUploading] = useState(false);
    const [updatingThumb, setUpdatingThumb] = useState(false);
    const [error, setError] = useState("");
    const [localFile, setLocalFile] = useState(null);
    const [lastResult, setLastResult] = useState(clip.youtubeUpload || null);

    useEffect(() => {
      setLastResult(clip.youtubeUpload || null);
      setError("");
    }, [clip.id, clip.youtubeUpload?.videoId]);

    const handleUpdateThumbnail = async () => {
      const vidId = lastResult?.videoId || clip.youtubeUpload?.videoId;
      if (!vidId) return;
      setUpdatingThumb(true);
      try {
        const thumbData = captureCoverDataUrl();
        await apiJson(`/api/projects/${project.id}/clips/${clip.id}/upload/youtube/thumbnail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId: vidId, thumbnailDataUrl: thumbData }),
        });
        toast("Cover image applied to YouTube Shorts! (YouTube may take 1-2 minutes to refresh the channel grid)");
        setLastResult((prev) => (prev ? { ...prev, thumbnailUploaded: true, thumbnailWarning: "" } : null));
      } catch (err) {
        toast(err.message, true);
      } finally {
        setUpdatingThumb(false);
      }
    };

    const yt = status?.youtube;
    const isLocalProject = project.source?.kind === "local";
    const hasServerExport = Boolean(clip.output?.file && clip.output.file !== "local");
    const hasTitle = Boolean(String(meta?.title || "").trim());
    const isScheduled = Boolean(publishAtLocal);

    const handleUpload = async () => {
      if (!yt?.connected) {
        openSettingsModal();
        return;
      }
      if (!hasTitle) {
        setError("Enter a Title above before uploading to YouTube.");
        return;
      }
      if (isLocalProject && !localFile) {
        setError("Choose the exported MP4 file from your computer first.");
        return;
      }
      if (!isLocalProject && !hasServerExport) {
        setError("Click Export MP4 at the top of Publish first, then upload.");
        return;
      }

      let publishAtIso = "";
      if (publishAtLocal) {
        const d = new Date(publishAtLocal);
        if (!Number.isFinite(d.getTime()) || d.getTime() <= Date.now() + 60_000) {
          setError("Scheduled publish time must be at least 1 minute in the future.");
          return;
        }
        publishAtIso = d.toISOString();
      }

      setUploading(true);
      setError("");
      try {
        if (draft?.flush) await draft.flush();

        const thumbnailDataUrl = uploadThumbnail ? captureCoverDataUrl() : "";

        let respData;
        if (isLocalProject && localFile) {
          const fd = new FormData();
          fd.append("file", localFile);
          fd.append("title", meta.title || "");
          fd.append("description", meta.description || "");
          fd.append("hashtags", JSON.stringify(meta.hashtags || []));
          fd.append("privacyStatus", publishAtIso ? "private" : privacy);
          fd.append("categoryId", categoryId);
          fd.append("madeForKids", String(madeForKids));
          fd.append("defaultLanguage", defaultLanguage);
          fd.append("publishAt", publishAtIso);
          fd.append("uploadThumbnail", String(uploadThumbnail));
          if (thumbnailDataUrl) fd.append("thumbnailDataUrl", thumbnailDataUrl);
          respData = await apiJson(`/api/projects/${project.id}/clips/${clip.id}/upload/youtube`, {
            method: "POST",
            body: fd,
          });
        } else {
          respData = await apiJson(`/api/projects/${project.id}/clips/${clip.id}/upload/youtube`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: meta.title || "",
              description: meta.description || "",
              hashtags: meta.hashtags || [],
              privacyStatus: publishAtIso ? "private" : privacy,
              categoryId,
              madeForKids,
              defaultLanguage,
              publishAt: publishAtIso,
              uploadThumbnail,
              thumbnailDataUrl,
            }),
          });
        }

        setLastResult(respData);
        toast(
          respData.publishAt
            ? "Uploaded & scheduled on YouTube!"
            : `Uploaded to YouTube (${respData.privacyStatus})!`
        );
      } catch (err) {
        setError(err.message);
        toast(err.message, true);
      } finally {
        setUploading(false);
      }
    };

    if (!yt?.connected) {
      return jsxs("div", {
        className: "stack",
        style: { gap: 8 },
        children: [
          jsxs("button", {
            type: "button",
            className: "btn btn-primary",
            onClick: openSettingsModal,
            children: [jsx(Upload, { size: 15 }), "Connect YouTube in Settings to upload"],
          }),
          jsx("p", {
            className: "note",
            children:
              "Add your YouTube API v3 OAuth Client ID and Client Secret in Settings to upload Shorts directly to your channel.",
          }),
        ],
      });
    }

    return jsxs("div", {
      className: "stack",
      style: { gap: 10 },
      children: [
        jsxs("div", {
          className: "row-between",
          children: [
            jsxs("span", {
              className: "status status-good",
              children: [
                jsx(Check, { size: 14 }),
                `Channel: ${yt.channelTitle || "Connected"}${yt.channelHandle ? ` (${yt.channelHandle})` : ""}`,
              ],
            }),
          ],
        }),

        // Visibility + Category
        jsxs("div", {
          className: "row",
          style: { alignItems: "flex-end", gap: 8 },
          children: [
            jsxs("div", {
              className: "field grow",
              children: [
                jsx("label", { htmlFor: `yt-privacy-${clip.id}`, children: "Visibility" }),
                jsxs("select", {
                  id: `yt-privacy-${clip.id}`,
                  className: "select",
                  value: isScheduled ? "private" : privacy,
                  onChange: (e) => {
                    setPrivacy(e.target.value);
                    try { localStorage.setItem("fivestar_yt_privacy", e.target.value); } catch {}
                  },
                  disabled: uploading || isScheduled,
                  children: [
                    jsx("option", { value: "private", children: isScheduled ? "Private (scheduled)" : "Private" }, "private"),
                    jsx("option", { value: "unlisted", children: "Unlisted" }, "unlisted"),
                    jsx("option", { value: "public", children: "Public" }, "public"),
                  ],
                }),
              ],
            }),
            jsxs("div", {
              className: "field grow",
              children: [
                jsx("label", { htmlFor: `yt-cat-${clip.id}`, children: "Category" }),
                jsxs("select", {
                  id: `yt-cat-${clip.id}`,
                  className: "select",
                  value: categoryId,
                  onChange: (e) => {
                    setCategoryId(e.target.value);
                    try { localStorage.setItem("fivestar_yt_categoryId", e.target.value); } catch {}
                  },
                  disabled: uploading,
                  children: YT_CATEGORIES.map((c) =>
                    jsx("option", { value: c.id, children: c.label }, c.id)
                  ),
                }),
              ],
            }),
          ],
        }),

        // Audience (required) + Language
        jsxs("div", {
          className: "row",
          style: { alignItems: "flex-end", gap: 8 },
          children: [
            jsxs("div", {
              className: "field grow",
              children: [
                jsx("label", { htmlFor: `yt-kids-${clip.id}`, children: "Audience (required)" }),
                jsxs("select", {
                  id: `yt-kids-${clip.id}`,
                  className: "select",
                  value: madeForKids ? "yes" : "no",
                  onChange: (e) => {
                    const v = e.target.value === "yes";
                    setMadeForKids(v);
                    try { localStorage.setItem("fivestar_yt_madeForKids", String(v)); } catch {}
                  },
                  disabled: uploading,
                  children: [
                    jsx("option", { value: "no", children: "No, not made for kids" }, "no"),
                    jsx("option", { value: "yes", children: "Yes, made for kids" }, "yes"),
                  ],
                }),
              ],
            }),
            jsxs("div", {
              className: "field grow",
              children: [
                jsx("label", { htmlFor: `yt-lang-${clip.id}`, children: "Language" }),
                jsxs("select", {
                  id: `yt-lang-${clip.id}`,
                  className: "select",
                  value: defaultLanguage,
                  onChange: (e) => {
                    setDefaultLanguage(e.target.value);
                    try { localStorage.setItem("fivestar_yt_language", e.target.value); } catch {}
                  },
                  disabled: uploading,
                  children: YT_LANGUAGES.map((l) =>
                    jsx("option", { value: l.code, children: l.label }, l.code || "auto")
                  ),
                }),
              ],
            }),
          ],
        }),

        // Optional schedule publish time
        jsxs("div", {
          className: "field",
          children: [
            jsxs("div", {
              className: "row-between",
              children: [
                jsx("label", { htmlFor: `yt-sched-${clip.id}`, children: "Schedule publish (optional)" }),
                publishAtLocal &&
                  jsx("button", {
                    type: "button",
                    className: "btn btn-small",
                    disabled: uploading,
                    onClick: () => setPublishAtLocal(""),
                    children: "Clear",
                  }),
              ],
            }),
            jsx("input", {
              id: `yt-sched-${clip.id}`,
              type: "datetime-local",
              className: "input",
              value: publishAtLocal,
              disabled: uploading,
              onChange: (e) => setPublishAtLocal(e.target.value),
            }),
            publishAtLocal &&
              jsx("span", {
                className: "note",
                children: "Uploads as Private and publishes automatically at this date & time.",
              }),
          ],
        }),

        // Cover image thumbnail option
        jsxs("div", {
          className: "stack",
          style: { gap: 4 },
          children: [
            jsxs("label", {
              className: "row",
              style: { gap: 8, fontSize: 13.5, cursor: "pointer" },
              children: [
                jsx("input", {
                  type: "checkbox",
                  checked: uploadThumbnail,
                  disabled: uploading,
                  onChange: (e) => {
                    setUploadThumbnail(e.target.checked);
                    try { localStorage.setItem("fivestar_yt_thumbnail", String(e.target.checked)); } catch {}
                  },
                }),
                "Upload Cover image as YouTube thumbnail",
              ],
            }),
            jsx("span", {
              className: "note",
              style: { fontSize: 12, marginLeft: 24 },
              children: "Automatically sets your 9:16 vertical Cover frame and locks it in after YouTube finishes processing.",
            }),
          ],
        }),

        isLocalProject &&
          jsxs("div", {
            className: "field",
            children: [
              jsx("label", {
                htmlFor: `yt-local-mp4-${clip.id}`,
                children: "Choose exported MP4 file to upload",
              }),
              jsx("input", {
                id: `yt-local-mp4-${clip.id}`,
                type: "file",
                accept: "video/mp4",
                className: "input",
                onChange: (e) => setLocalFile(e.target.files?.[0] || null),
              }),
            ],
          }),

        jsxs("button", {
          type: "button",
          className: "btn btn-primary",
          disabled: uploading || !hasTitle || (!isLocalProject && !hasServerExport),
          onClick: handleUpload,
          children: [
            uploading ? jsx(Spinner, { size: 15 }) : jsx(Upload, { size: 15 }),
            uploading ? "Uploading to YouTube…" : "Upload to YouTube",
          ],
        }),

        !hasTitle &&
          jsx("p", {
            className: "note",
            children: "Enter a Title above to enable uploading.",
          }),
        !isLocalProject &&
          !hasServerExport &&
          jsx("p", {
            className: "note",
            children: "Export the MP4 above first, then click Upload to YouTube.",
          }),
        clip.dirty &&
          hasServerExport &&
          jsx("p", {
            className: "note",
            children: "You edited this clip since the last export. Export again if you want the latest edits uploaded.",
          }),
        error &&
          jsxs("p", {
            className: "status status-bad",
            children: [jsx(ErrorIcon, { size: 15 }), error],
          }),
        lastResult?.videoId &&
          jsxs("div", {
            className: "stack",
            style: {
              gap: 6,
              padding: "10px 12px",
              borderRadius: "var(--r-sm, 8px)",
              border: "1px solid var(--line-strong)",
              background: "var(--surface-2, rgba(255,255,255,0.03))",
            },
            children: [
              jsxs("span", {
                className: "status status-good",
                children: [
                  jsx(Check, { size: 15 }),
                  lastResult.publishAt
                    ? `Scheduled on ${lastResult.channelTitle || "YouTube"} (${new Date(lastResult.publishAt).toLocaleString()})`
                    : `Uploaded to ${lastResult.channelTitle || "YouTube"} (${lastResult.privacyStatus || "private"})`,
                ],
              }),
              lastResult.thumbnailUploaded &&
                jsx("span", { className: "note", children: "Cover image uploaded as thumbnail." }),
              lastResult.thumbnailWarning &&
                jsx("span", { className: "note", children: lastResult.thumbnailWarning }),
              jsxs("div", {
                className: "row",
                style: { flexWrap: "wrap", gap: 6 },
                children: [
                  jsxs("a", {
                    className: "btn btn-small",
                    href: lastResult.url,
                    target: "_blank",
                    rel: "noreferrer",
                    children: [jsx(External, { size: 13 }), "Open Short"],
                  }),
                  jsxs("a", {
                    className: "btn btn-small",
                    href: lastResult.studioUrl,
                    target: "_blank",
                    rel: "noreferrer",
                    children: [jsx(External, { size: 13 }), "YouTube Studio"],
                  }),
                  jsxs("button", {
                    type: "button",
                    className: "btn btn-small",
                    disabled: updatingThumb,
                    onClick: handleUpdateThumbnail,
                    title: "Apply or re-sync the 9:16 Cover image to this live YouTube Short",
                    style: { gap: 4, display: "inline-flex", alignItems: "center" },
                    children: [
                      updatingThumb ? jsx(Spinner, { size: 13 }) : "🖼️",
                      updatingThumb ? "Applying Thumbnail…" : "Apply Cover to Short",
                    ],
                  }),
                ],
              }),
            ],
          }),
      ],
    });
  }

  function InstagramUploadBox({ project, clip, draft, meta }) {
    const { status } = useSocialStatus();
    const [shareToFeed, setShareToFeed] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState("");
    const [localFile, setLocalFile] = useState(null);
    const [lastResult, setLastResult] = useState(clip.instagramUpload || null);

    useEffect(() => {
      setLastResult(clip.instagramUpload || null);
      setError("");
    }, [clip.id, clip.instagramUpload?.mediaId]);

    const ig = status?.instagram;
    const isLocalProject = project.source?.kind === "local";
    const hasServerExport = Boolean(clip.output?.file && clip.output.file !== "local");

    const handleUpload = async () => {
      if (!ig?.connected) {
        openSettingsModal();
        return;
      }
      if (isLocalProject && !localFile) {
        setError("Choose the exported MP4 file from your computer first.");
        return;
      }
      if (!isLocalProject && !hasServerExport) {
        setError("Click Export MP4 at the top of Publish first, then upload.");
        return;
      }

      setUploading(true);
      setError("");
      try {
        if (draft?.flush) await draft.flush();

        const coverTime = typeof clip.cover?.t === "number" ? clip.cover.t : null;
        const thumbOffsetMs =
          coverTime !== null ? Math.max(0, Math.round((coverTime - (clip.in || 0)) * 1000)) : null;

        let respData;
        if (isLocalProject && localFile) {
          const fd = new FormData();
          fd.append("file", localFile);
          fd.append("caption", meta.instagramCaption || "");
          fd.append("shareToFeed", String(shareToFeed));
          if (thumbOffsetMs !== null) fd.append("thumbOffsetMs", String(thumbOffsetMs));
          respData = await apiJson(
            `/api/projects/${project.id}/clips/${clip.id}/upload/instagram`,
            {
              method: "POST",
              body: fd,
            }
          );
        } else {
          respData = await apiJson(
            `/api/projects/${project.id}/clips/${clip.id}/upload/instagram`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                caption: meta.instagramCaption || "",
                shareToFeed,
                ...(thumbOffsetMs !== null ? { thumbOffsetMs } : {}),
              }),
            }
          );
        }

        setLastResult(respData);
        toast("Published Reel to Instagram!");
      } catch (err) {
        setError(err.message);
        toast(err.message, true);
      } finally {
        setUploading(false);
      }
    };

    if (!ig?.connected) {
      return jsxs("div", {
        className: "stack",
        style: { gap: 8 },
        children: [
          jsxs("div", {
            className: "row",
            style: { flexWrap: "wrap", gap: 8 },
            children: [
              jsxs("button", {
                type: "button",
                className: "btn btn-primary",
                onClick: openSettingsModal,
                children: [jsx(Upload, { size: 15 }), "Connect Instagram in Settings"],
              }),
              jsxs("a", {
                className: "btn",
                href: "https://www.instagram.com/",
                target: "_blank",
                rel: "noreferrer",
                children: [jsx(External, { size: 15 }), "Open Instagram"],
              }),
            ],
          }),
          jsx("p", {
            className: "note",
            children:
              "Add your Instagram Business/Creator Graph API token in Settings to publish Reels directly, or open Instagram manually.",
          }),
        ],
      });
    }

    return jsxs("div", {
      className: "stack",
      style: { gap: 8 },
      children: [
        jsxs("div", {
          className: "row-between",
          children: [
            jsxs("span", {
              className: "status status-good",
              children: [
                jsx(Check, { size: 14 }),
                ig.username ? `Account: @${ig.username}` : "Instagram connected",
              ],
            }),
            jsxs("label", {
              className: "row",
              style: { gap: 6, fontSize: 13, cursor: "pointer" },
              children: [
                jsx("input", {
                  type: "checkbox",
                  checked: shareToFeed,
                  disabled: uploading,
                  onChange: (e) => setShareToFeed(e.target.checked),
                }),
                "Share to feed",
              ],
            }),
          ],
        }),
        isLocalProject &&
          jsxs("div", {
            className: "field",
            children: [
              jsx("label", {
                htmlFor: `ig-local-mp4-${clip.id}`,
                children: "Choose exported MP4 file to upload",
              }),
              jsx("input", {
                id: `ig-local-mp4-${clip.id}`,
                type: "file",
                accept: "video/mp4",
                className: "input",
                onChange: (e) => setLocalFile(e.target.files?.[0] || null),
              }),
            ],
          }),
        jsxs("button", {
          type: "button",
          className: "btn btn-primary",
          disabled: uploading || (!isLocalProject && !hasServerExport),
          onClick: handleUpload,
          children: [
            uploading ? jsx(Spinner, { size: 15 }) : jsx(Upload, { size: 15 }),
            uploading ? "Uploading & processing Reel…" : "Upload to Instagram",
          ],
        }),
        !isLocalProject &&
          !hasServerExport &&
          jsx("p", {
            className: "note",
            children: "Export the MP4 above first, then click Upload to Instagram.",
          }),
        error &&
          jsxs("p", {
            className: "status status-bad",
            children: [jsx(ErrorIcon, { size: 15 }), error],
          }),
        lastResult?.mediaId &&
          jsxs("div", {
            className: "stack",
            style: {
              gap: 6,
              padding: "10px 12px",
              borderRadius: "var(--r-sm, 8px)",
              border: "1px solid var(--line-strong)",
              background: "var(--surface-2, rgba(255,255,255,0.03))",
            },
            children: [
              jsxs("span", {
                className: "status status-good",
                children: [
                  jsx(Check, { size: 15 }),
                  `Published Reel${lastResult.username ? ` to @${lastResult.username}` : ""}`,
                ],
              }),
              lastResult.permalink &&
                jsxs("a", {
                  className: "btn btn-small",
                  href: lastResult.permalink,
                  target: "_blank",
                  rel: "noreferrer",
                  children: [jsx(External, { size: 13 }), "Open Reel"],
                }),
            ],
          }),
      ],
    });
  }

  function SocialIntegrationHelp() {
    const [ytOpen, setYtOpen] = useState(false);
    const [igOpen, setIgOpen] = useState(false);
    const redirectUri = "http://127.0.0.1:8765/oauth/youtube/callback";

    const cardStyle = {
      border: "1px solid var(--line-strong, rgba(255,255,255,0.12))",
      borderRadius: "var(--r-sm, 10px)",
      background: "var(--surface-2, rgba(255,255,255,0.03))",
      overflow: "hidden",
      transition: "all 0.2s ease",
    };

    const headerBtnStyle = {
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 16px",
      background: "transparent",
      border: "none",
      color: "inherit",
      cursor: "pointer",
      textAlign: "left",
      fontSize: 14.5,
      fontWeight: 600,
    };

    const contentStyle = {
      padding: "0 16px 16px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      fontSize: 13.5,
      color: "var(--text-soft, #cbd5e1)",
      lineHeight: 1.55,
    };

    const stepNumStyle = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 20,
      height: 20,
      borderRadius: "50%",
      background: "var(--primary, #8b5cf6)",
      color: "#fff",
      fontSize: 11.5,
      fontWeight: 700,
      marginRight: 8,
      flexShrink: 0,
      marginTop: 2,
    };

    return jsxs("div", {
      className: "group",
      style: { marginTop: 22, borderTop: "1px solid var(--line)", paddingTop: 18 },
      children: [
        jsxs("div", {
          className: "group-head",
          style: { alignItems: "center", marginBottom: 12, display: "flex", justifyContent: "space-between" },
          children: [
            jsxs("div", {
              children: [
                jsx("h3", {
                  style: { display: "flex", alignItems: "center", gap: 8 },
                  children: "Integration Instructions (YouTube & Instagram)",
                }),
                jsx("p", {
                  className: "note",
                  style: { margin: "4px 0 0 0" },
                  children:
                    "Connect your accounts once in Settings (⚙️) to upload YouTube Shorts and Instagram Reels directly from Fivestar.",
                }),
              ],
            }),
            jsx("button", {
              type: "button",
              className: "btn btn-small",
              onClick: openSettingsModal,
              children: "Open Settings ⚙️",
            }),
          ],
        }),

        jsxs("div", {
          className: "stack",
          style: { gap: 10 },
          children: [
            // ---- YouTube Guide Card ----
            jsxs("div", {
              style: cardStyle,
              children: [
                jsxs("div", {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    padding: "14px 16px",
                  },
                  children: [
                    jsxs("div", {
                      style: { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" },
                      onClick: () => setYtOpen((v) => !v),
                      children: [
                        jsx("span", { style: { fontSize: 20, lineHeight: 1.2, marginTop: 1, flexShrink: 0 }, children: "🔴" }),
                        jsxs("div", {
                          style: { flex: 1, minWidth: 0 },
                          children: [
                            jsx("div", {
                              style: { fontSize: 14.5, fontWeight: 600, color: "var(--text, #f1f5f9)", lineHeight: 1.35 },
                              children: "YouTube Shorts Setup Guide (Data API v3)",
                            }),
                            jsx("p", {
                              className: "note",
                              style: { margin: "3px 0 0 0", fontSize: 12.5, lineHeight: 1.4 },
                              children: "Configure Google Cloud OAuth 2.0 Web Client to upload Shorts directly.",
                            }),
                          ],
                        }),
                      ],
                    }),
                    jsxs("div", {
                      className: "row",
                      style: { gap: 8, alignItems: "center", flexWrap: "wrap" },
                      children: [
                        jsx("a", {
                          href: "/youtube-guide.html",
                          target: "_blank",
                          rel: "noreferrer",
                          className: "btn btn-small btn-primary",
                          style: { textDecoration: "none", fontSize: 12.5, padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600 },
                          children: ["Open Guide in new tab ↗"],
                        }),
                        jsx("a", {
                          href: "https://www.youtube.com/watch?v=hz-Kyb18IBw",
                          target: "_blank",
                          rel: "noreferrer",
                          className: "btn btn-small",
                          style: { textDecoration: "none", fontSize: 12.5, padding: "5px 11px", display: "inline-flex", alignItems: "center", gap: 5, color: "#fca5a5", border: "1px solid rgba(239, 68, 68, 0.45)", background: "rgba(239, 68, 68, 0.08)" },
                          children: ["🎥 Video Tutorial (Hindi) ↗"],
                        }),
                        jsx("button", {
                          type: "button",
                          className: "btn btn-small",
                          onClick: () => setYtOpen((v) => !v),
                          style: { fontSize: 12.5, padding: "5px 10px" },
                          children: ytOpen ? "▲ Hide steps" : "▼ Preview steps",
                        }),
                      ],
                    }),
                  ],
                }),
                ytOpen &&
                  jsxs("div", {
                    style: contentStyle,
                    children: [
                      jsxs("div", {
                        style: {
                          background: "rgba(239, 68, 68, 0.12)",
                          border: "1px solid rgba(239, 68, 68, 0.35)",
                          borderRadius: 8,
                          padding: "8px 12px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 10,
                        },
                        children: [
                          jsxs("div", {
                            style: { fontSize: 12.5, color: "#fca5a5" },
                            children: [
                              jsx("strong", { children: "🎥 Recommended Indian Video: " }),
                              "Techno Smarter — Google OAuth Client ID & Secret in Google Cloud (Hindi)",
                            ],
                          }),
                          jsx("a", {
                            href: "https://www.youtube.com/watch?v=hz-Kyb18IBw",
                            target: "_blank",
                            rel: "noreferrer",
                            style: { color: "#ffffff", background: "#ff0033", padding: "4px 9px", borderRadius: 5, fontSize: 11.5, fontWeight: 600, textDecoration: "none" },
                            children: "▶ Watch on YouTube ↗",
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "1" }),
                          jsxs("div", {
                            children: [
                              jsx("strong", { children: "Create Google Cloud Project: " }),
                              "Go to ",
                              jsx("a", {
                                href: "https://console.cloud.google.com/",
                                target: "_blank",
                                rel: "noreferrer",
                                style: { color: "#60a5fa", textDecoration: "underline" },
                                children: "Google Cloud Console",
                              }),
                              " and create or select a project (e.g. ",
                              jsx("code", { children: "Fivestar" }),
                              ").",
                            ],
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "2" }),
                          jsxs("div", {
                            children: [
                              jsx("strong", { children: "Enable YouTube Data API v3: " }),
                              "In the sidebar go to ",
                              jsx("b", { children: "APIs & Services > Library" }),
                              ", search for ",
                              jsx("b", { children: "YouTube Data API v3" }),
                              ", and click ",
                              jsx("b", { children: "Enable" }),
                              ".",
                            ],
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "3" }),
                          jsxs("div", {
                            children: [
                              jsx("strong", { children: "Configure OAuth Consent Screen: " }),
                              "Go to ",
                              jsx("b", { children: "APIs & Services > OAuth consent screen" }),
                              ", select ",
                              jsx("b", { children: "External" }),
                              ", fill in an App Name (e.g. Fivestar) and user support email. Under ",
                              jsx("b", { children: "Test users" }),
                              ", add the Google email account associated with your YouTube channel.",
                            ],
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "4" }),
                          jsxs("div", {
                            style: { width: "100%" },
                            children: [
                              jsx("strong", { children: "Create OAuth 2.0 Web Credentials: " }),
                              "Go to ",
                              jsx("b", { children: "APIs & Services > Credentials > Create Credentials > OAuth client ID" }),
                              ". Set Application type to ",
                              jsx("b", { children: "Web application" }),
                              ". Under ",
                              jsx("b", { children: "Authorized redirect URIs" }),
                              ", add this exact URI:",
                              jsxs("div", {
                                className: "row",
                                style: { gap: 6, marginTop: 6, alignItems: "center" },
                                children: [
                                  jsx("input", {
                                    className: "input",
                                    value: redirectUri,
                                    readOnly: true,
                                    style: { fontSize: 12.5, padding: "5px 10px" },
                                    onFocus: (e) => e.target.select(),
                                  }),
                                  jsxs("button", {
                                    type: "button",
                                    className: "btn btn-small",
                                    onClick: async () =>
                                      toast((await copyText(redirectUri)) ? "Redirect URI copied" : "Failed to copy"),
                                    children: [jsx(Copy, { size: 13 }), "Copy"],
                                  }),
                                ],
                              }),
                            ],
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "5" }),
                          jsxs("div", {
                            children: [
                              jsx("strong", { children: "Connect YouTube in Fivestar: " }),
                              "Copy your generated ",
                              jsx("b", { children: "Client ID" }),
                              " and ",
                              jsx("b", { children: "Client Secret" }),
                              ", open ",
                              jsx("a", {
                                href: "#",
                                onClick: (e) => {
                                  e.preventDefault();
                                  openSettingsModal();
                                },
                                style: { color: "#60a5fa", textDecoration: "underline" },
                                children: "Settings (⚙️)",
                              }),
                              ", paste them into the YouTube direct upload section, and click ",
                              jsx("b", { children: "Connect YouTube channel" }),
                              ". Your channel and handle will connect immediately!",
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
              ],
            }),

            // ---- Instagram Guide Card ----
            jsxs("div", {
              style: cardStyle,
              children: [
                jsxs("div", {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    padding: "14px 16px",
                  },
                  children: [
                    jsxs("div", {
                      style: { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" },
                      onClick: () => setIgOpen((v) => !v),
                      children: [
                        jsx("span", { style: { fontSize: 20, lineHeight: 1.2, marginTop: 1, flexShrink: 0 }, children: "🟣" }),
                        jsxs("div", {
                          style: { flex: 1, minWidth: 0 },
                          children: [
                            jsx("div", {
                              style: { fontSize: 14.5, fontWeight: 600, color: "var(--text, #f1f5f9)", lineHeight: 1.35 },
                              children: "Instagram Reels Setup Guide (Graph API)",
                            }),
                            jsx("p", {
                              className: "note",
                              style: { margin: "3px 0 0 0", fontSize: 12.5, lineHeight: 1.4 },
                              children: "Configure Meta Graph API User Token to publish Reels directly.",
                            }),
                          ],
                        }),
                      ],
                    }),
                    jsxs("div", {
                      className: "row",
                      style: { gap: 8, alignItems: "center", flexWrap: "wrap" },
                      children: [
                        jsx("a", {
                          href: "/instagram-guide.html",
                          target: "_blank",
                          rel: "noreferrer",
                          className: "btn btn-small btn-primary",
                          style: { textDecoration: "none", fontSize: 12.5, padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600 },
                          children: ["Open Guide in new tab ↗"],
                        }),
                        jsx("a", {
                          href: "https://www.youtube.com/watch?v=STfP0X_zDBE",
                          target: "_blank",
                          rel: "noreferrer",
                          className: "btn btn-small",
                          style: { textDecoration: "none", fontSize: 12.5, padding: "5px 11px", display: "inline-flex", alignItems: "center", gap: 5, color: "#f9a8d4", border: "1px solid rgba(229, 89, 146, 0.45)", background: "rgba(229, 89, 146, 0.08)" },
                          children: ["🎥 Video Tutorial (Hindi) ↗"],
                        }),
                        jsx("button", {
                          type: "button",
                          className: "btn btn-small",
                          onClick: () => setIgOpen((v) => !v),
                          style: { fontSize: 12.5, padding: "5px 10px" },
                          children: igOpen ? "▲ Hide steps" : "▼ Preview steps",
                        }),
                      ],
                    }),
                  ],
                }),
                igOpen &&
                  jsxs("div", {
                    style: contentStyle,
                    children: [
                      jsxs("div", {
                        style: {
                          background: "rgba(229, 89, 146, 0.12)",
                          border: "1px solid rgba(229, 89, 146, 0.35)",
                          borderRadius: 8,
                          padding: "8px 12px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          flexWrap: "wrap",
                          marginBottom: 10,
                        },
                        children: [
                          jsxs("div", {
                            style: { fontSize: 12.5, color: "#f9a8d4" },
                            children: [
                              jsx("strong", { children: "🎥 Recommended Indian Video: " }),
                              "Solutions with Shahzain — Meta Graph API Complete Guide (Hindi/Urdu)",
                            ],
                          }),
                          jsx("a", {
                            href: "https://www.youtube.com/watch?v=STfP0X_zDBE",
                            target: "_blank",
                            rel: "noreferrer",
                            style: { color: "#ffffff", background: "#ff0033", padding: "4px 9px", borderRadius: 5, fontSize: 11.5, fontWeight: 600, textDecoration: "none" },
                            children: "▶ Watch on YouTube ↗",
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "1" }),
                          jsxs("div", {
                            children: [
                              jsx("strong", { children: "Account Prerequisites: " }),
                              "Ensure your Instagram account is switched to a ",
                              jsx("b", { children: "Professional (Business or Creator)" }),
                              " account and linked to a ",
                              jsx("b", { children: "Facebook Page" }),
                              " that you manage.",
                            ],
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "2" }),
                          jsxs("div", {
                            children: [
                              jsx("strong", { children: "Create a Meta App: " }),
                              "Go to ",
                              jsx("a", {
                                href: "https://developers.facebook.com/",
                                target: "_blank",
                                rel: "noreferrer",
                                style: { color: "#60a5fa", textDecoration: "underline" },
                                children: "Meta for Developers",
                              }),
                              " and click ",
                              jsx("b", { children: "Create App" }),
                              " (choose use case: ",
                              jsx("b", { children: "Other > Business" }),
                              ").",
                            ],
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "3" }),
                          jsxs("div", {
                            children: [
                              jsx("strong", { children: "Generate Access Token in Graph API Explorer: " }),
                              "Open the ",
                              jsx("a", {
                                href: "https://developers.facebook.com/tools/explorer/",
                                target: "_blank",
                                rel: "noreferrer",
                                style: { color: "#60a5fa", textDecoration: "underline" },
                                children: "Meta Graph API Explorer",
                              }),
                              ". Select your App, and add these permissions: ",
                              jsx("code", { children: "instagram_basic" }),
                              ", ",
                              jsx("code", { children: "instagram_content_publish" }),
                              ", ",
                              jsx("code", { children: "pages_show_list" }),
                              ", and ",
                              jsx("code", { children: "pages_read_engagement" }),
                              ". Click ",
                              jsx("b", { children: "Generate Access Token" }),
                              " and grant access to your Facebook Page and linked Instagram account.",
                            ],
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "4" }),
                          jsxs("div", {
                            children: [
                              jsx("strong", { children: "60-Day Auto-Refresh Keys (Optional): " }),
                              "In your Meta App Dashboard under ",
                              jsx("b", { children: "App settings > Basic" }),
                              ", find your ",
                              jsx("b", { children: "App ID" }),
                              " and ",
                              jsx("b", { children: "App Secret" }),
                              ". Adding these in Fivestar lets it extend and auto-refresh your Instagram access token for up to 60 days.",
                            ],
                          }),
                        ],
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "flex-start" },
                        children: [
                          jsx("span", { style: stepNumStyle, children: "5" }),
                          jsxs("div", {
                            children: [
                              jsx("strong", { children: "Connect Instagram in Fivestar: " }),
                              "Open ",
                              jsx("a", {
                                href: "#",
                                onClick: (e) => {
                                  e.preventDefault();
                                  openSettingsModal();
                                },
                                style: { color: "#60a5fa", textDecoration: "underline" },
                                children: "Settings (⚙️)",
                              }),
                              ", paste the generated Access Token (and optional App ID / App Secret), and click ",
                              jsx("b", { children: "Save & connect Instagram" }),
                              ". Your Instagram username and ID will connect and verify immediately!",
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  return {
    SocialSettingsSection,
    YouTubeUploadBox,
    InstagramUploadBox,
    SocialIntegrationHelp,
  };
}
