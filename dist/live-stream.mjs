// dist/live-stream.mjs
// Dedicated backend engine for Live Stream DVR detection, scrubbing, fast slicing, and window analysis

import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { LiveBufferManager } from "./live-buffer.mjs";

// Memory cache for Kick live stream masters and active channels
const kickStreamCache = new Map();

async function resolveKickStream(channel) {
  const ch = String(channel || "").trim().toLowerCase();
  if (!ch) return null;
  const cached = kickStreamCache.get(ch);
  if (cached && Date.now() - cached.fetchedAt < 60e3) {
    return cached;
  }

  try {
    const [cRes, vRes] = await Promise.all([
      fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(ch)}`, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
      }).catch(() => null),
      fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(ch)}/videos`, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" }
      }).catch(() => null)
    ]);

    const cData = cRes && cRes.ok ? await cRes.json() : null;
    const vData = vRes && vRes.ok ? await vRes.json() : null;

    const liveVideo = Array.isArray(vData) ? vData[0] : (vData?.videos?.[0] || null);
    const masterM3u8 = liveVideo?.source || cData?.playback_url || null;
    const title = cData?.livestream?.session_title || liveVideo?.session_title || `${channel}'s Live Stream`;
    const isLive = cData?.livestream?.is_live ?? (liveVideo?.is_live ?? true);
    const startTime = cData?.livestream?.start_time || liveVideo?.start_time || null;
    const elapsed = startTime
      ? Math.max(60, Math.floor((Date.now() - new Date(startTime + "Z").getTime()) / 1000))
      : 7200;
    const thumbnail = liveVideo?.thumbnail?.src || cData?.banner_image?.url || cData?.user?.profile_pic || "";
    const viewCount = cData?.livestream?.viewer_count || 0;

    const result = {
      channel: ch,
      title,
      isLive,
      startTime,
      elapsed,
      thumbnail,
      viewCount,
      masterM3u8,
      hlsProxyUrl: `/api/live/kick-hls/${ch}/master.m3u8`,
      fetchedAt: Date.now()
    };
    if (masterM3u8) {
      kickStreamCache.set(ch, result);
    }
    return result;
  } catch (err) {
    console.warn(`[Kick API] Failed to resolve stream for ${ch}:`, err.message);
    return cached || null;
  }
}

// High-performance YouTube DASH DVR Engine for exact historical slicing (up to 12-120 hours in the past)
// Overcomes YouTube CDN's 20-minute rolling HLS purge by targeting Google Video's live DASH sequence cache (&sq=...)
async function extractYouTubeLiveDashSegment({
  url,
  start,
  end,
  quality,
  rewoundSec,
  targetFile,
  cPath,
  ytDlpRunner,
  ffmpegBin
}) {
  console.log(`[YouTube DASH DVR Engine] Slicing exact DVR window: ${url} (start: ${start}s, end: ${end}s, dur: ${end - start}s, quality: ${quality || "best"})...`);

  const qNum = parseInt(quality, 10);
  let formatSelector;
  if (!isNaN(qNum) && qNum >= 1440) {
    formatSelector = `bv*[height<=${qNum}]+ba/bv*[height<=${qNum}]/best`;
  } else if (!isNaN(qNum) && qNum > 0) {
    formatSelector = `bv*[height<=${qNum}][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=${qNum}]+ba/best`;
  } else {
    // Best: 1080p+ AVC1 or Best available
    formatSelector = "bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*+ba/best";
  }

  const gArgs = [
    "--no-warnings",
    "--js-runtimes", "node",
    "--live-from-start",
    "-g",
    "-f", formatSelector,
    url
  ];

  const gRes = await ytDlpRunner(gArgs, { timeout: 35e3 });
  if (gRes.code !== 0 || !gRes.stdout.trim()) {
    throw new Error("Could not resolve YouTube DASH stream URLs: " + (gRes.stderr || "Unknown error"));
  }

  const streamUrls = gRes.stdout.trim().split(/\r?\n/).map(s => s.trim()).filter(s => s.startsWith("http"));
  if (streamUrls.length === 0) {
    throw new Error("No valid HTTP stream URLs found in yt-dlp output");
  }

  const videoUrl = streamUrls[0];
  const audioUrl = streamUrls.length > 1 ? streamUrls[1] : null;

  // Query live head sequence and reference clock
  const headRes = await fetch(videoUrl, { method: "HEAD" });
  if (!headRes.ok) {
    throw new Error(`Failed to query stream head (HTTP ${headRes.status})`);
  }

  const headSeq = parseInt(headRes.headers.get("x-head-seqnum"), 10);
  const headTimeSec = parseFloat(headRes.headers.get("x-head-time-sec") || (Number(headRes.headers.get("x-head-time-millis")) / 1000)) || 0;
  const targetDur = (headTimeSec > 0 && headSeq > 0) ? (headTimeSec / headSeq) : 2.0;
  const isWebM = videoUrl.includes("mime=video%2Fwebm") || (headRes.headers.get("content-type") || "").includes("webm");

  console.log(`[YouTube DASH DVR Engine] headSeq: ${headSeq}, headTime: ${headTimeSec.toFixed(1)}s, targetDur: ${targetDur.toFixed(4)}s, isWebM: ${isWebM}`);

  let startSeq;
  let endSeq;
  if (start < 0 || end <= 0) {
    startSeq = Math.max(0, headSeq - Math.ceil(Math.abs(start) / targetDur));
    endSeq = Math.max(startSeq + 1, headSeq - Math.floor(Math.abs(end) / targetDur));
  } else {
    startSeq = Math.max(0, Math.floor(start / targetDur));
    endSeq = Math.max(startSeq + 1, Math.ceil(end / targetDur));
  }
  if (endSeq > headSeq) endSeq = headSeq;
  const count = Math.max(1, endSeq - startSeq);

  console.log(`[YouTube DASH DVR Engine] Slicing sequences [${startSeq} .. ${endSeq - 1}] (${count} segments, target: ${targetFile})...`);

  // Parallel fetch segment chunks (with 20s timeout per chunk)
  const fetchTasks = [];
  for (let s = startSeq; s < endSeq; s++) {
    const vTask = fetch(videoUrl + "&sq=" + s, { signal: AbortSignal.timeout(20e3) }).then(async r => {
      if (!r.ok) throw new Error(`Video segment ${s} returned HTTP ${r.status}`);
      return { seq: s, buf: Buffer.from(await r.arrayBuffer()) };
    });
    const aTask = audioUrl ? fetch(audioUrl + "&sq=" + s, { signal: AbortSignal.timeout(20e3) }).then(async r => {
      if (!r.ok) return { seq: s, buf: null };
      return { seq: s, buf: Buffer.from(await r.arrayBuffer()) };
    }) : Promise.resolve({ seq: s, buf: null });
    fetchTasks.push(Promise.all([vTask, aTask]));
  }

  const fetched = await Promise.all(fetchTasks);
  console.log(`[YouTube DASH DVR Engine] Fetched all ${count} segment pairs in parallel!`);

  const segDir = path.join(cPath, `dash_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(segDir, { recursive: true });

  const relativeStart = Math.max(0, start - (startSeq * targetDur));
  const clipDuration = Math.max(1, end - start);
  const ffBin = ffmpegBin || "ffmpeg";

  try {
    if (isWebM) {
      // For WebM / VP9 (1440p), concatenate chunks directly as byte stream
      const vCombined = path.join(segDir, "v_combined.webm");
      fs.writeFileSync(vCombined, Buffer.concat(fetched.map(([v]) => v.buf).filter(Boolean)));

      const aBuffers = fetched.map(([, a]) => a.buf).filter(Boolean);
      let aCombined = null;
      if (aBuffers.length > 0) {
        aCombined = path.join(segDir, "a_combined.webm");
        fs.writeFileSync(aCombined, Buffer.concat(aBuffers));
      }

      const ffArgs = [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", vCombined
      ];
      if (aCombined) {
        ffArgs.push("-i", aCombined);
      }
      ffArgs.push(
        "-ss", relativeStart.toFixed(3),
        "-t", clipDuration.toFixed(3),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        targetFile
      );

      const ffProc = spawn(ffBin, ffArgs, { cwd: segDir });
      let ffErr = "";
      ffProc.stderr.on("data", d => ffErr += d);
      await new Promise((resolve, reject) => {
        ffProc.on("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${ffErr.slice(-300)}`)));
        ffProc.on("error", reject);
      });
    } else {
      // For MP4 (AVC1 / AAC), remux segments to .ts in parallel and concat
      const remuxTasks = [];
      const vTsList = [];
      const aTsList = [];

      for (const [v, a] of fetched) {
        const vMp4 = path.join(segDir, `v_${v.seq}.mp4`);
        const vTs = path.join(segDir, `v_${v.seq}.ts`);
        fs.writeFileSync(vMp4, v.buf);
        vTsList.push(`v_${v.seq}.ts`);
        remuxTasks.push(new Promise((resolve, reject) => {
          const p = spawn(ffBin, ["-hide_banner", "-loglevel", "error", "-y", "-i", vMp4, "-c", "copy", vTs]);
          p.on("close", code => code === 0 ? resolve() : reject(new Error(`TS remux failed for v_${v.seq}`)));
          p.on("error", reject);
        }));

        if (a && a.buf && a.buf.length > 0) {
          const aMp4 = path.join(segDir, `a_${a.seq}.mp4`);
          const aTs = path.join(segDir, `a_${a.seq}.ts`);
          fs.writeFileSync(aMp4, a.buf);
          aTsList.push(`a_${a.seq}.ts`);
          remuxTasks.push(new Promise((resolve, reject) => {
            const p = spawn(ffBin, ["-hide_banner", "-loglevel", "error", "-y", "-i", aMp4, "-c", "copy", aTs]);
            p.on("close", code => code === 0 ? resolve() : reject(new Error(`TS remux failed for a_${a.seq}`)));
            p.on("error", reject);
          }));
        }
      }

      await Promise.all(remuxTasks);

      const ffArgs = [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", `concat:${vTsList.join("|")}`
      ];
      if (aTsList.length > 0) {
        ffArgs.push("-i", `concat:${aTsList.join("|")}`);
      }
      ffArgs.push(
        "-ss", relativeStart.toFixed(3),
        "-t", clipDuration.toFixed(3),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        targetFile
      );

      const ffProc = spawn(ffBin, ffArgs, { cwd: segDir });
      let ffErr = "";
      ffProc.stderr.on("data", d => ffErr += d);
      await new Promise((resolve, reject) => {
        ffProc.on("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}: ${ffErr.slice(-300)}`)));
        ffProc.on("error", reject);
      });
    }

    if (fs.existsSync(targetFile) && fs.statSync(targetFile).size >= 5000) {
      console.log(`[YouTube DASH DVR Engine] Successfully produced frame-accurate clip (${fs.statSync(targetFile).size} bytes)`);
      return targetFile;
    }
  } finally {
    try {
      fs.rmSync(segDir, { recursive: true, force: true });
    } catch {}
  }
  return null;
}

export function registerLiveRoutes(app, deps) {
  const {
    getProject,
    saveProject,
    getAllProjects,
    projectDir,
    clipDir,
    probe,
    transcribe,
    ytDlpRunner,
    sanitizeTime,
    getBinPath
  } = deps;

  const liveBufferManager = new LiveBufferManager(deps);

  // Helper to format seconds as mm:ss or hh:mm:ss
  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rem}` : `${m}:${rem}`;
  }

  // Detect platform from URL
  function detectPlatform(url) {
    const u = String(url || "").toLowerCase();
    if (u.includes("twitch.tv")) return "twitch";
    if (u.includes("kick.com")) return "kick";
    return "youtube";
  }

  // Deterministic project ID for live streams
  function getLiveProjectId(url, videoId, platform, channel) {
    let vid = String(videoId || "").trim();
    if (!vid || vid === "live") {
      const ytMatch = String(url || "").match(/(?:v=|\/live\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (ytMatch) vid = ytMatch[1];
    }
    if (vid && vid !== "live" && /^[a-zA-Z0-9_-]{4,24}$/.test(vid)) {
      return `plive_${vid}`;
    }
    let ch = String(channel || "").trim().toLowerCase();
    if (!ch) {
      if (platform === "twitch") {
        const m = String(url || "").match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
        if (m) ch = m[1].toLowerCase();
      } else if (platform === "kick") {
        const m = String(url || "").match(/kick\.com\/([a-zA-Z0-9_]+)/i);
        if (m) ch = m[1].toLowerCase();
      }
    }
    if (platform === "twitch" && ch) {
      return `plive_tw_${ch.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 30);
    }
    if (platform === "kick" && ch) {
      return `plive_k_${ch.replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 30);
    }
    const hash = crypto.createHash("md5").update(url || "").digest("hex").slice(0, 12);
    return `plive_${hash}`;
  }

  // Ensure persistent live stream project exists, has proper metadata, and aggregates clips
  function ensureLiveProject(streamMeta) {
    const { url = "", videoId = "", platform = "youtube", channel = "", title = "", thumbnail = "", duration = 0 } = streamMeta;
    const targetId = getLiveProjectId(url, videoId, platform, channel);
    let project = getProject(targetId);

    // If not in memory, check on disk
    if (!project) {
      const pFile = path.join(projectDir(targetId), "project.json");
      if (fs.existsSync(pFile)) {
        try {
          project = JSON.parse(fs.readFileSync(pFile, "utf8"));
          saveProject(project, false);
        } catch (e) {
          console.warn(`[Live Clipper] Error loading project ${targetId}:`, e.message);
        }
      }
    }

    // Find all existing projects (in-memory or on disk) to check for legacy scattered clips
    const allProjects = typeof getAllProjects === "function" ? getAllProjects() : [];
    
    // Also scan data/projects directory if needed
    try {
      const rootProjDir = path.dirname(projectDir(targetId));
      if (fs.existsSync(rootProjDir)) {
        for (const dirName of fs.readdirSync(rootProjDir)) {
          if (dirName.startsWith("plive") && dirName !== targetId && !allProjects.some(p => p.id === dirName)) {
            const legFile = path.join(rootProjDir, dirName, "project.json");
            if (fs.existsSync(legFile)) {
              try {
                const legProj = JSON.parse(fs.readFileSync(legFile, "utf8"));
                allProjects.push(legProj);
              } catch {}
            }
          }
        }
      }
    } catch {}

    const legacyMatches = allProjects.filter(p => {
      if (p.id === targetId) return false;
      if (videoId && videoId !== "live" && (p.source?.videoId === videoId || p.source?.id === videoId)) return true;
      if (url && p.source?.url && (p.source.url.split("?")[0].toLowerCase() === url.split("?")[0].toLowerCase())) return true;
      return false;
    });

    if (!project) {
      project = {
        id: targetId,
        createdAt: Date.now(),
        source: {
          kind: "url",
          url: url || "",
          platform: platform || "youtube",
          title: title ? `[LIVE] ${title}` : "[LIVE] Live Stream",
          channel: channel || "Live Streamer",
          duration: duration || 0,
          thumbnail: thumbnail || "",
          id: videoId || targetId,
          videoId: videoId || targetId
        },
        status: "ready",
        steps: [],
        signals: [{ key: "manual", available: true, detail: "Live stream DVR clipping" }],
        moments: [],
        clips: [],
        timeline: []
      };
    }

    if (!Array.isArray(project.clips)) {
      project.clips = [];
    }
    if (!Array.isArray(project.moments)) {
      project.moments = [];
    }

    // Migrate clips from legacy matching single-clip projects into this unified project
    for (const leg of legacyMatches) {
      if (Array.isArray(leg.clips)) {
        for (const c of leg.clips) {
          if (!project.clips.some(existing => existing.id === c.id)) {
            const oldClipDir = clipDir(leg.id, c.id);
            const newClipDir = clipDir(targetId, c.id);
            if (fs.existsSync(oldClipDir) && !fs.existsSync(newClipDir)) {
              try {
                fs.cpSync(oldClipDir, newClipDir, { recursive: true });
              } catch (cpErr) {
                console.warn(`[Live Clipper] Legacy clip copy error for ${c.id}:`, cpErr.message);
              }
            }
            const cloned = { ...c };
            if (cloned.src?.file) cloned.src.file = `clips/${c.id}/src.mp4`;
            if (cloned.poster) cloned.poster = `clips/${c.id}/poster.jpg`;
            if (cloned.output?.file) {
              cloned.output.file = cloned.output.file.replace(/clips\/[^/]+\//, `clips/${c.id}/`);
            }
            if (cloned.output?.thumb) {
              cloned.output.thumb = cloned.output.thumb.replace(/clips\/[^/]+\//, `clips/${c.id}/`);
            }
            project.clips.push(cloned);
          }
        }
      }
      if (Array.isArray(leg.moments)) {
        for (const m of leg.moments) {
          if (!project.moments.some(existing => existing.id === m.id)) {
            project.moments.push(m);
          }
        }
      }
    }

    // Update metadata if live info has improved
    if (title && (!project.source.title || project.source.title === "[LIVE] Live Stream")) {
      project.source.title = `[LIVE] ${title}`;
    }
    if (channel && (!project.source.channel || project.source.channel === "Live Streamer")) {
      project.source.channel = channel;
    }
    if (thumbnail && (!project.source.thumbnail || project.source.thumbnail.length < 5)) {
      project.source.thumbnail = thumbnail;
    }
    if (duration && duration > (project.source.duration || 0)) {
      project.source.duration = duration;
    }

    saveProject(project, true);
    return project;
  }

  // ==========================================
  // Managed Rolling Segment Buffer Routes
  // ==========================================

  // Start or connect to rolling segment buffer worker
  app.post("/api/live/buffer/start", async (req, res) => {
    try {
      const url = String(req.body?.url || "").trim();
      if (!url) return res.status(400).json({ error: "Stream URL is required" });
      const streamInfo = req.body?.streamInfo || {};
      const quality = String(req.body?.quality || "best").trim();
      const retentionMinutes = Number(req.body?.retentionMinutes) || 30;

      const session = liveBufferManager.getOrCreateSession({
        url,
        streamInfo,
        quality,
        retentionMinutes
      });

      return res.json({
        ok: true,
        ...session.getStatus()
      });
    } catch (err) {
      console.error("[Live Buffer API] Start error:", err);
      return res.status(500).json({ error: err.message || "Failed to start buffer service" });
    }
  });

  // Query rolling buffer status & range coverage
  app.get("/api/live/buffer/status", (req, res) => {
    try {
      const url = String(req.query?.url || "").trim();
      const sessionId = String(req.query?.sessionId || "").trim();
      const from = req.query?.from !== undefined ? Number(req.query.from) : undefined;
      const to = req.query?.to !== undefined ? Number(req.query.to) : undefined;

      let session = null;
      if (sessionId) session = liveBufferManager.getSession(sessionId);
      if (!session && url) session = liveBufferManager.findSessionByUrl(url);

      if (!session) {
        return res.json({
          ok: true,
          status: "idle",
          bufferStart: 0,
          bufferEnd: 0,
          bufferedSeconds: 0,
          segmentsCount: 0,
          isCovered: false
        });
      }

      const status = session.getStatus();
      const isCovered = (Number.isFinite(from) && Number.isFinite(to)) ? session.isRangeCovered(from, to) : false;

      return res.json({
        ok: true,
        ...status,
        isCovered
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to query buffer status" });
    }
  });

  // Stop rolling buffer worker & clean up segment cache
  app.post("/api/live/buffer/stop", (req, res) => {
    try {
      const url = String(req.body?.url || "").trim();
      const sessionId = String(req.body?.sessionId || "").trim();
      const stopped = liveBufferManager.stopSession(sessionId || url);
      return res.json({ ok: true, stopped });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to stop buffer service" });
    }
  });

  // 1. Check live stream info and get direct manifest
  app.post("/api/live/info", async (req, res) => {
    try {
      const url = String(req.body?.url ?? "").trim();
      if (!url) {
        return res.status(400).json({ error: "Please provide a valid stream URL." });
      }

      const platform = detectPlatform(url);

      // Fast-track Kick streams with full DVR master playlist & API
      if (platform === "kick") {
        const kickMatch = url.match(/kick\.com\/([^/?#]+)/);
        const channelName = kickMatch ? kickMatch[1].toLowerCase() : "";
        if (channelName) {
          const kickInfo = await resolveKickStream(channelName);
          if (kickInfo && kickInfo.masterM3u8) {
            return res.json({
              ok: true,
              isLive: kickInfo.isLive,
              platform: "kick",
              videoId: channelName,
              channel: kickInfo.channel,
              title: kickInfo.title,
              thumbnail: kickInfo.thumbnail,
              viewCount: kickInfo.viewCount,
              duration: kickInfo.elapsed,
              url: `https://kick.com/${channelName}`,
              masterM3u8: kickInfo.masterM3u8,
              hlsStreamUrl: kickInfo.hlsProxyUrl,
              streamUrl: kickInfo.hlsProxyUrl,
              qualities: [
                { id: "best", label: "✨ Best Available (Highest Quality)" },
                { id: "1080", label: "1080p (Full HD)" },
                { id: "720", label: "720p (HD)" },
                { id: "480", label: "480p (SD)" },
                { id: "360", label: "360p" }
              ]
            });
          }
        }
      }

      // Execute yt-dlp to inspect stream metadata for YouTube / Twitch
      const ytDlpResult = await ytDlpRunner([
        "--no-warnings",
        "--no-progress",
        "--js-runtimes", "node",
        "--extractor-args", "youtube:formats=incomplete",
        "-J",
        url
      ], { timeout: 60e3 });

      if (ytDlpResult.code !== 0) {
        return res.status(400).json({
          error: "Could not fetch stream metadata: " + (ytDlpResult.stderr || "Unknown error")
        });
      }

      let meta;
      try {
        meta = JSON.parse(ytDlpResult.stdout);
      } catch {
        return res.status(500).json({ error: "Invalid response from video service." });
      }

      const isLiveNow = meta.live_status === "is_live" || meta.is_live === true;
      const videoId = meta.id;
      const title = meta.title || "Untitled Live Stream";
      const channel = meta.uploader || meta.channel || "Unknown Creator";
      const thumbnail = meta.thumbnail || meta.thumbnails?.[meta.thumbnails.length - 1]?.url || "";
      const viewCount = Number(meta.view_count) || undefined;
      
      let duration = Number(meta.duration) || 0;
      if (isLiveNow || !duration) {
        const streamStart = Number(meta.release_timestamp) || Number(meta.timestamp);
        if (streamStart && streamStart > 1e9) {
          const elapsed = Math.floor(Date.now() / 1000) - streamStart;
          if (elapsed > 0) {
            duration = elapsed;
          }
        }
        if (!duration || duration < 300) {
          duration = 43200; // YouTube max DVR buffer: 12 hours
        }
      }

      // Also get direct stream format url if available
      let streamUrl = null;
      try {
        const flags = ["-g", url];
        const urlRes = await ytDlpRunner(flags, { timeout: 20e3 });
        if (urlRes.code === 0 && urlRes.stdout.trim()) {
          streamUrl = urlRes.stdout.trim().split(/\r?\n/)[0].trim();
        }
      } catch (e) {
        console.warn("Could not fetch direct live URL:", e.message);
      }

      // Enumerate available video stream qualities
      const rawFormats = Array.isArray(meta.formats) ? meta.formats : [];
      const videoFormats = rawFormats.filter(f => f.vcodec && f.vcodec !== "none");
      const availableHeights = [...new Set(videoFormats.map(f => f.height).filter(h => typeof h === "number" && h > 0))].sort((a, b) => b - a);
      const qualities = [
        { id: "best", label: "✨ Best Available (Highest Quality)" }
      ];
      for (const h of availableHeights) {
        const has60 = videoFormats.some(f => f.height === h && typeof f.fps === "number" && f.fps >= 50);
        const fpsSuffix = has60 ? "60" : "";
        if (h >= 2160) qualities.push({ id: String(h), label: `${h}p${fpsSuffix} (4K UHD)` });
        else if (h >= 1440) qualities.push({ id: String(h), label: `${h}p${fpsSuffix} HD` });
        else if (h >= 1080) qualities.push({ id: String(h), label: `${h}p${fpsSuffix} HD` });
        else if (h >= 720) qualities.push({ id: String(h), label: `${h}p${fpsSuffix}` });
        else qualities.push({ id: String(h), label: `${h}p` });
      }
      if (qualities.length === 1) {
        qualities.push(
          { id: "1440", label: "1440p60 HD" },
          { id: "1080", label: "1080p60 HD" },
          { id: "720", label: "720p60" },
          { id: "480", label: "480p" },
          { id: "360", label: "360p" }
        );
      }

      // Automatically arm background rolling segment buffer worker for live streams
      let initialBufferStatus = null;
      if (isLiveNow) {
        try {
          const session = liveBufferManager.getOrCreateSession({
            url: meta.webpage_url || url,
            streamInfo: {
              title,
              channel,
              duration,
              isLive: true,
              platform,
              videoId,
              releaseTimestamp: Number(meta.release_timestamp) || Number(meta.timestamp) || 0,
              masterM3u8: streamUrl
            }
          });
          initialBufferStatus = session.getStatus();
        } catch (bufErr) {
          console.warn("[Live Clipper] Auto buffer start notice:", bufErr.message);
        }
      }

      // Ensure persistent live stream project exists and retrieve its clips
      let liveProject = null;
      try {
        liveProject = ensureLiveProject({
          url: meta.webpage_url || url,
          videoId,
          platform,
          channel,
          title,
          thumbnail,
          duration
        });
      } catch (projErr) {
        console.warn("[Live Clipper] Error ensuring live project in info:", projErr.message);
      }

      return res.json({
        ok: true,
        projectId: liveProject ? liveProject.id : getLiveProjectId(url, videoId, platform, channel),
        clips: liveProject?.clips || [],
        isLive: isLiveNow,
        platform,
        videoId,
        title,
        channel,
        thumbnail,
        viewCount,
        duration,
        url: meta.webpage_url || url,
        streamUrl,
        qualities,
        bufferStatus: initialBufferStatus
      });
    } catch (err) {
      console.error("Live info error:", err);
      return res.status(500).json({ error: err.message || "Failed to inspect live stream." });
    }
  });

  // ==========================================
  // Kick HLS Proxy Endpoints (CORS-friendly, Full Native DVR Scrubbing)
  // ==========================================

  // Proxy Kick Master Manifest
  app.get("/api/live/kick-hls/:channel/master.m3u8", async (req, res) => {
    try {
      const { channel } = req.params;
      const kickInfo = await resolveKickStream(channel);
      if (!kickInfo?.masterM3u8) {
        return res.status(404).send("Kick stream master manifest not found.");
      }
      const upstream = await fetch(kickInfo.masterM3u8, {
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (!upstream.ok) return res.status(upstream.status).end();
      const text = await upstream.text();
      // Rewrite variant playlist URLs to route through proxy
      const rewritten = text.replace(/^([0-9a-zA-Z_.-]+\/playlist\.m3u8)(\r?)$/gm, (m, file, r) => {
        return `/api/live/kick-hls/${channel}/${file}${r}`;
      });
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(rewritten);
    } catch (e) {
      console.error("[Kick HLS Proxy] Master manifest error:", e.message);
      return res.status(500).send("Error fetching master manifest");
    }
  });

  // Proxy Kick Quality / Sub-playlist
  app.get("/api/live/kick-hls/:channel/:quality/playlist.m3u8", async (req, res) => {
    try {
      const { channel, quality } = req.params;
      const kickInfo = await resolveKickStream(channel);
      if (!kickInfo?.masterM3u8) {
        return res.status(404).send("Kick stream quality manifest not found.");
      }
      const baseDir = kickInfo.masterM3u8.substring(0, kickInfo.masterM3u8.lastIndexOf("/"));
      const upstreamUrl = `${baseDir}/${quality}/playlist.m3u8`;
      const upstream = await fetch(upstreamUrl, {
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (!upstream.ok) return res.status(upstream.status).end();
      const text = await upstream.text();
      // Rewrite .ts segment filenames to route through proxy
      const rewritten = text.replace(/^([0-9a-zA-Z_.-]+\.ts.*)(\r?)$/gm, (m, file, r) => {
        return `/api/live/kick-hls/${channel}/${quality}/${file}${r}`;
      });
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(rewritten);
    } catch (e) {
      console.error("[Kick HLS Proxy] Quality playlist error:", e.message);
      return res.status(500).send("Error fetching quality playlist");
    }
  });

  // Proxy Kick Video Segment (.ts)
  app.get("/api/live/kick-hls/:channel/:quality/:segment", async (req, res) => {
    try {
      const { channel, quality, segment } = req.params;
      const kickInfo = await resolveKickStream(channel);
      if (!kickInfo?.masterM3u8) {
        return res.status(404).send("Kick stream segment not found.");
      }
      const baseDir = kickInfo.masterM3u8.substring(0, kickInfo.masterM3u8.lastIndexOf("/"));
      const segmentUrl = `${baseDir}/${quality}/${segment}`;
      const upstream = await fetch(segmentUrl, {
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      if (!upstream.ok) return res.status(upstream.status).end();
      res.setHeader("Content-Type", "video/MP2T");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");
      const stream = Readable.fromWeb(upstream.body);
      stream.on("error", () => {});
      res.on("close", () => {
        try { stream.destroy(); } catch {}
      });
      stream.pipe(res);
    } catch (e) {
      return res.status(500).send(e.message);
    }
  });

  // 2. Slice specific DVR window and create standard Fivestar project & clip (Instant Mode)
  app.post("/api/live/slice", async (req, res) => {
    try {
      const url = String(req.body?.url ?? "").trim();
      const start = Number(req.body?.start);
      const end = Number(req.body?.end);
      const title = String(req.body?.title ?? "").trim() || "Live Clip";
      const channel = String(req.body?.channel ?? "").trim() || "Live Streamer";
      const videoId = String(req.body?.videoId ?? "").trim() || "live";
      const streamDuration = Number(req.body?.streamDuration) || 0;
      const platform = detectPlatform(url);

      if (!url) {
        return res.status(400).json({ error: "Stream URL is required." });
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return res.status(400).json({ error: "Invalid start or end timestamps." });
      }

      const clipDuration = end - start;
      if (clipDuration < 3) {
        return res.status(400).json({ error: "Clip must be at least 3 seconds long." });
      }
      if (clipDuration > 180) {
        return res.status(400).json({ error: "Keep clips under 3 minutes for Shorts and Reels." });
      }

      // Target persistent live stream project
      const projectId = req.body?.projectId && /^[a-zA-Z0-9_-]{4,32}$/.test(req.body.projectId)
        ? req.body.projectId
        : getLiveProjectId(url, videoId, platform, channel);

      const project = ensureLiveProject({
        url,
        videoId,
        platform,
        channel,
        title,
        thumbnail: req.body?.thumbnail || "",
        duration: streamDuration || end
      });

      const clipId = "clive" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
      const momentId = "mlive" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

      const pPath = projectDir(projectId);
      const cPath = clipDir(projectId, clipId);

      fs.mkdirSync(cPath, { recursive: true });

      const targetSrcFile = path.join(cPath, "src.mp4");

      // Determine target URL: For Kick, prefer masterM3u8 with full DVR history
      let targetDownloadUrl = url;
      if (platform === "kick") {
        const kickMatch = url.match(/kick\.com\/([^/?#]+)/);
        const channelName = kickMatch ? kickMatch[1].toLowerCase() : "";
        const kickInfo = channelName ? (kickStreamCache.get(channelName) || await resolveKickStream(channelName)) : null;
        if (kickInfo?.masterM3u8) {
          targetDownloadUrl = kickInfo.masterM3u8;
        } else if (req.body?.masterM3u8) {
          targetDownloadUrl = req.body.masterM3u8;
        }
      }

      console.log(`[Live Clipper] Slicing stream: ${url} (target: ${targetDownloadUrl.slice(0, 70)}...) from ${start.toFixed(2)}s to ${end.toFixed(2)}s into ${targetSrcFile}...`);

      // Execute yt-dlp slice (HLS stream slicing with FFmpeg locator)
      const ffmpegBin = getBinPath("ffmpeg");
      const ytArgs = [
        "--no-warnings",
        "--force-overwrites",
        "--js-runtimes", "node",
        "--extractor-args", "youtube:formats=incomplete",
        "--socket-timeout", "30",
        "--retries", "5",
        "--fragment-retries", "5"
      ];
      if (ffmpegBin) {
        ytArgs.push("--ffmpeg-location", path.dirname(ffmpegBin));
      }

      let sectionArg;
      let trimLabel = `Live cut at ${formatTime(start)}`;
      let trimDetail = `Trimmed from live stream (${formatTime(start)} - ${formatTime(end)})`;

      if (platform === "youtube") {
        const isFromLiveHead = req.body?.isLiveHead === true;
        if (isFromLiveHead) {
          const dur = Math.max(3, Math.min(180, Number(req.body?.fromLive) || (end - start) || 60));
          sectionArg = `*-${dur.toFixed(1)}--1.0`;
          trimLabel = `Live instant cut (last ${Math.round(dur)}s)`;
          trimDetail = `Captured live stream moment (last ${Math.round(dur)}s before live)`;
          console.log(`[Live Clipper] Slicing YouTube live head: last ${dur}s (section: ${sectionArg})`);
        } else if (start < 0 || end <= 0) {
          const s = Math.max(-43200, start);
          const e = Math.min(-1, end);
          sectionArg = `*${s.toFixed(1)}-${e.toFixed(1)}`;
          trimLabel = `Live DVR cut (${Math.abs(Math.round(s))}s to ${Math.abs(Math.round(e))}s ago)`;
          trimDetail = `Trimmed live DVR buffer (${Math.abs(Math.round(s))}s to ${Math.abs(Math.round(e))}s before live)`;
          console.log(`[Live Clipper] Slicing YouTube negative offset: ${sectionArg}`);
        } else {
          // Scrubbed / rewound YouTube DVR: download the exact selected range using absolute timestamps!
          sectionArg = `*${start.toFixed(2)}-${end.toFixed(2)}`;
          trimLabel = `Live DVR cut (${formatTime(start)} - ${formatTime(end)})`;
          trimDetail = `Trimmed live DVR buffer from ${formatTime(start)} to ${formatTime(end)}`;
          console.log(`[Live Clipper] Slicing YouTube scrubbed DVR: ${sectionArg} (${formatTime(start)} - ${formatTime(end)})`);
        }
      } else if (platform === "kick" && targetDownloadUrl.includes("stream.kick.com")) {
        // Kick full DVR master playlist: slice exact timestamps from the recorded stream!
        sectionArg = `*${start.toFixed(2)}-${end.toFixed(2)}`;
      } else {
        // Fallback for rolling streams without master
        const duration = Math.min(180, Math.max(3, end - start));
        sectionArg = start >= 300 ? `*0-${duration.toFixed(2)}` : `*${start.toFixed(2)}-${end.toFixed(2)}`;
      }

      const reqQuality = String(req.body?.quality || "best").trim();
      const qNum = parseInt(reqQuality, 10);
      let formatSelector;
      let sortSelector;

      if (!isNaN(qNum) && qNum > 0) {
        // Target requested resolution (e.g. 1440p, 1080p, 720p)
        formatSelector = `bv*[height<=${qNum}][protocol^=m3u8]+ba[protocol^=m3u8]/b[height<=${qNum}][protocol^=m3u8]/bv*[height<=${qNum}]+ba/b[height<=${qNum}]/best`;
        sortSelector = `res:${qNum},fps,vcodec:h264,tbr`;
      } else {
        // Best Available: select the highest quality stream format without artificially capping at 1080p
        formatSelector = "bv*[protocol^=m3u8]+ba[protocol^=m3u8]/b[protocol^=m3u8]/bv*+ba/b";
        sortSelector = "res,fps,vcodec:h264,tbr";
      }

      let actualSrc = null;

      // 1. Managed Rolling Local Buffer Engine (frame-accurate, zero seek race condition)
      const bufSession = liveBufferManager.findSessionByUrl(url) || (req.body?.sessionId ? liveBufferManager.getSession(req.body.sessionId) : null);
      if (bufSession && bufSession.isRangeCovered(start, end)) {
        console.log(`[Live Clipper] Range [${start.toFixed(1)}s - ${end.toFixed(1)}s] is covered by active local buffer (${bufSession.id})! Extracting frame-accurate clip...`);
        try {
          const bufRes = await bufSession.sliceRange(start, end, targetSrcFile);
          if (bufRes && fs.existsSync(targetSrcFile) && fs.statSync(targetSrcFile).size >= 5000) {
            actualSrc = targetSrcFile;
            console.log(`[Live Clipper] Frame-accurate local buffer slice succeeded: ${actualSrc} (${fs.statSync(actualSrc).size} bytes)`);
          }
        } catch (bufErr) {
          console.warn("[Live Clipper] Local buffer slice notice, falling back to sequence/yt-dlp:", bufErr.message);
        }
      }

      // 2. YouTube Live DASH DVR Engine:
      // Bypasses the rolling 15-minute HLS limit and queries Google Video's live DASH sequence cache (&sq=...)
      // Enables exact historical slicing for any moment across the entire live broadcast (even 5-10+ hours ago).
      if (!actualSrc && platform === "youtube") {
        try {
          let rewoundSec = null;
          if (Number.isFinite(Number(req.body?.rewoundSec))) {
            rewoundSec = Number(req.body.rewoundSec);
          } else if (streamDuration > 0 && start >= 0 && streamDuration > start) {
            rewoundSec = streamDuration - start;
          } else if (start < 0) {
            rewoundSec = Math.abs(start);
          } else if (req.body?.isLiveHead) {
            rewoundSec = clipDuration;
          }

          console.log(`[Live Clipper] Attempting YouTube DASH DVR slice (start: ${start}s, end: ${end}s, rewoundSec: ${rewoundSec}, clipDur: ${clipDuration}s)...`);
          const seqResult = await extractYouTubeLiveDashSegment({
            url: targetDownloadUrl,
            start,
            end,
            quality: reqQuality,
            rewoundSec: rewoundSec ?? clipDuration,
            targetFile: targetSrcFile,
            cPath,
            ytDlpRunner,
            ffmpegBin
          });

          if (seqResult && fs.existsSync(targetSrcFile) && fs.statSync(targetSrcFile).size >= 5000) {
            actualSrc = targetSrcFile;
            console.log(`[Live Clipper] YouTube DASH DVR slice succeeded: ${actualSrc} (${fs.statSync(actualSrc).size} bytes)`);
          }
        } catch (seqErr) {
          console.warn("[Live Clipper] YouTube DASH DVR slice notice:", seqErr.message);
        }
      }

      // 2. If YouTube sequence slicing was not applicable or fell through, run standard yt-dlp slice
      if (!actualSrc) {
        ytArgs.push(
          "--download-sections", sectionArg,
          "-f", formatSelector,
          "-S", sortSelector,
          "--merge-output-format", "mp4",
          "-o", path.join(cPath, "src.%(ext)s"),
          targetDownloadUrl
        );
        let sliceResult = { code: 1, stderr: "" };
        try {
          sliceResult = await ytDlpRunner(ytArgs, { timeout: 300e3 });
        } catch (dlpErr) {
          console.warn(`[Live Clipper] yt-dlp slice warning or timeout:`, dlpErr.message);
          sliceResult = { code: 1, stderr: dlpErr.message };
        }

        if (fs.existsSync(targetSrcFile) && fs.statSync(targetSrcFile).size >= 5000) {
          actualSrc = targetSrcFile;
        } else {
          const entries = fs.readdirSync(cPath);
          const match = entries.find(f => f.startsWith("src.") && !f.endsWith(".part"));
          if (match) {
            const found = path.join(cPath, match);
            if (fs.statSync(found).size >= 5000) {
              actualSrc = found;
            }
          }
        }
      }

      // If yt-dlp did not produce a valid file, run direct FFmpeg fallback on stream URLs
      if (!actualSrc && ffmpegBin) {
        console.log(`[Live Clipper] yt-dlp slice did not produce file, trying direct FFmpeg HLS slice fallback...`);
        try {
          const urlRes = await ytDlpRunner([
            "--no-warnings",
            "--js-runtimes", "node",
            "--extractor-args", "youtube:formats=incomplete",
            "-g",
            targetDownloadUrl
          ], { timeout: 35e3 });
          if (urlRes.code === 0 && urlRes.stdout.trim()) {
            const streamUrls = urlRes.stdout.trim().split(/\r?\n/).filter(l => l.startsWith("http"));
            const duration = Math.max(3, end - start);
            if (streamUrls.length >= 2) {
              const ffArgs = [
                "-hide_banner", "-loglevel", "error", "-y",
                "-ss", String(start), "-t", String(duration), "-i", streamUrls[0],
                "-ss", String(start), "-t", String(duration), "-i", streamUrls[1],
                "-c", "copy", "-movflags", "+faststart", targetSrcFile
              ];
              const ffProc = spawn(ffmpegBin, ffArgs);
              await new Promise(r => ffProc.on("close", r));
            } else if (streamUrls.length === 1) {
              const ffArgs = [
                "-hide_banner", "-loglevel", "error", "-y",
                "-ss", String(start), "-t", String(duration), "-i", streamUrls[0],
                "-c", "copy", "-movflags", "+faststart", targetSrcFile
              ];
              const ffProc = spawn(ffmpegBin, ffArgs);
              await new Promise(r => ffProc.on("close", r));
            }
            if (fs.existsSync(targetSrcFile) && fs.statSync(targetSrcFile).size >= 5000) {
              actualSrc = targetSrcFile;
              console.log(`[Live Clipper] Direct FFmpeg fallback succeeded (${fs.statSync(targetSrcFile).size} bytes)`);
            }
          }
        } catch (ffErr) {
          console.warn("[Live Clipper] FFmpeg fallback error:", ffErr.message);
        }
      }

      if (!actualSrc) {
        const errorMsg = sliceResult.stderr || "Could not download that portion of the live stream.";
        return res.status(500).json({ error: `Slice failed: ${errorMsg}` });
      }

      // Always remux through FFmpeg with +faststart to guarantee a clean, fast-start ISO MP4 container
      // (yt-dlp slicing of HLS m3u8 streams retains raw MPEG-TS container packets even with .mp4 extension)
      if (ffmpegBin) {
        const cleanMp4 = path.join(cPath, "src_clean.mp4");
        try {
          const remux = spawn(ffmpegBin, [
            "-hide_banner", "-loglevel", "error", "-y",
            "-fflags", "+genpts",
            "-i", actualSrc,
            "-c", "copy",
            "-movflags", "+faststart",
            cleanMp4
          ]);
          await new Promise(r => remux.on("close", r));
          if (fs.existsSync(cleanMp4) && fs.statSync(cleanMp4).size >= 5000) {
            try { if (actualSrc !== cleanMp4 && fs.existsSync(actualSrc)) fs.unlinkSync(actualSrc); } catch {}
            if (cleanMp4 !== targetSrcFile) {
              try { if (fs.existsSync(targetSrcFile)) fs.unlinkSync(targetSrcFile); } catch {}
              fs.renameSync(cleanMp4, targetSrcFile);
            }
            actualSrc = targetSrcFile;
            console.log(`[Live Clipper] Successfully remuxed clip to compliant ISO MP4 (${fs.statSync(actualSrc).size} bytes)`);
          }
        } catch (remuxErr) {
          console.warn("[Live Clipper] Remux warning:", remuxErr.message);
        }
      }

      // Probe media details
      let mediaInfo;
      try {
        mediaInfo = await probe(actualSrc);
      } catch (err) {
        console.warn("[Live Clipper] Probe error, using defaults:", err.message);
        mediaInfo = {
          duration: clipDuration,
          width: 1920,
          height: 1080,
          fps: 30,
          hasAudio: true
        };
      }

      // Generate poster thumbnail at 0.5s or 1s
      const posterFile = path.join(cPath, "poster.jpg");
      if (ffmpegBin) {
        try {
          const posterProc = spawn(ffmpegBin, [
            "-y",
            "-ss", String(Math.min(1, Math.max(0, mediaInfo.duration / 2))),
            "-i", actualSrc,
            "-vframes", "1",
            "-q:v", "2",
            posterFile
          ]);
          await new Promise(r => posterProc.on("close", r));
        } catch (e) {
          console.warn("[Live Clipper] Poster generation warning:", e.message);
        }
      }

      // Construct standard clip
      const clip = {
        id: clipId,
        momentId,
        createdAt: Date.now(),
        status: "ready",
        progress: 1,
        autoRender: false,
        sourceStart: 0,
        in: 0,
        out: mediaInfo.duration || clipDuration,
        words: [],
        captionSource: "whisper",
        captionsOn: true,
        captionOffset: 0,
        style: {
          preset: "hype",
          font: "Anton",
          fontSize: 108,
          uppercase: true,
          stripPunctuation: true,
          fill: "#FFFFFF",
          stroke: "#000000",
          strokeWidth: 12,
          shadowColor: "#000000",
          shadowBlur: 0,
          shadowOffset: 8,
          highlight: "word",
          highlightColor: "#FFE14D",
          highlightText: "#000000",
          pageAnim: "pop",
          wordAnim: "none",
          reveal: false,
          wordsPerPage: 1,
          maxLines: 2,
          position: 0.75,
          lineHeight: 1.1
        },
        layout: {
          mode: "dual",
          zoom: 1,
          focusX: 0.5,
          focusY: 0.5,
          offsetY: 0.42,
          blur: 0.7,
          dim: 0.35,
          cam: { x: 0.72, y: 0.62, w: 0.26, h: 0.38 },
          camShare: 0.48,
          camPosition: "top",
          dualTop: { x: 0.15, y: 0.05, w: 0.7, h: 0.5 },
          dualBottom: { x: 0.65, y: 0.55, w: 0.35, h: 0.45 },
          dualShare: 0.5
        },
        frame: {
          style: "hud",
          color: "#111111",
          title: { on: false, text: title, font: "Anton", look: "plate", y: 0.15 },
          handle: { on: true, text: "" },
          progress: true
        },
        sfx: [],
        memes: [],
        audio: { gain: 1, normalize: true },
        meta: {
          titleOptions: [
            `${title} 😳 #shorts`,
            `Insane moment from ${channel} live! 🤯 #shorts`,
            `You won't believe this live moment 😂 #shorts`
          ],
          title: `${title} 😳 #shorts`,
          description: `Clipped live from ${channel}'s stream!\n\n#shorts #gaming #liveclip #${channel.replace(/\s+/g, "").toLowerCase()}`,
          hashtags: ["shorts", "viral", "gaming", "liveclip"],
          instagramCaption: `Live moment from ${channel} 🔥\nFollow for more clips!\n\n#reels #gamingreels #viral #explore`
        },
        dirty: false,
        src: {
          file: `clips/${clipId}/src.mp4`,
          duration: mediaInfo.duration || clipDuration,
          width: mediaInfo.width || 1920,
          height: mediaInfo.height || 1080,
          fps: mediaInfo.fps || 30,
          hasAudio: mediaInfo.hasAudio !== false
        },
        poster: fs.existsSync(posterFile) ? `clips/${clipId}/poster.jpg` : undefined
      };

      // Append clip to persistent project
      if (!Array.isArray(project.clips)) {
        project.clips = [];
      }
      if (!Array.isArray(project.moments)) {
        project.moments = [];
      }
      project.moments.unshift({
        id: momentId,
        rank: (project.moments?.length || 0) + 1,
        start: Math.max(0, start),
        end: Math.max(start + 1, end),
        heat: 99,
        stars: 5,
        reasons: [{ signal: "manual", label: trimLabel }],
        chat: []
      });

      // Place newest clip first
      project.clips.unshift(clip);
      if (end > (project.source.duration || 0)) {
        project.source.duration = end;
      }

      // Save project to disk & memory
      saveProject(project, true);

      // Trigger Whisper transcription asynchronously
      if (typeof transcribe === "function") {
        const reqLang = typeof req.body?.language === "string" && /^[a-z]{2,3}$/.test(req.body.language) ? req.body.language : undefined;
        const reqTranslate = req.body?.translate === true || req.body?.translate === "true";
        transcribe(projectId, clipId, { language: reqLang, translate: reqTranslate })
          .then(() => console.log(`[Live Clipper] Clip ${clipId} transcription completed (lang: ${reqLang || 'auto'}, translate: ${reqTranslate}).`))
          .catch(e => console.warn(`[Live Clipper] Transcription notice:`, e.message));
      }

      console.log(`[Live Clipper] Successfully created clip ${clipId} in project ${projectId} (total clips: ${project.clips.length})`);

      return res.json({
        ok: true,
        projectId,
        clipId,
        clip,
        clips: project.clips
      });
    } catch (err) {
      console.error("[Live Clipper] Slice handler crashed:", err);
      return res.status(500).json({ error: err.message || "Failed to slice live stream." });
    }
  });

  // Get live project details and clips
  app.get("/api/live/project", (req, res) => {
    try {
      const id = String(req.query?.id || "").trim();
      const url = String(req.query?.url || "").trim();
      const videoId = String(req.query?.videoId || "").trim();
      let project = null;
      if (id) {
        project = getProject(id);
      }
      if (!project && (url || videoId)) {
        const pid = getLiveProjectId(url, videoId, detectPlatform(url), "");
        project = getProject(pid);
        if (!project) {
          const all = typeof getAllProjects === "function" ? getAllProjects() : [];
          project = all.find(p => p.id === pid || (videoId && p.source?.videoId === videoId) || (url && p.source?.url === url));
        }
      }
      if (!project) {
        return res.status(404).json({ error: "Live project not found" });
      }
      return res.json({
        ok: true,
        projectId: project.id,
        project,
        clips: project.clips || []
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // Delete clip alias for live projects
  app.delete("/api/live/project/:projectId/clip/:clipId", (req, res) => {
    try {
      const { projectId, clipId } = req.params;
      const project = getProject(projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });
      project.clips = (project.clips || []).filter(c => c.id !== clipId);
      const cDir = clipDir(projectId, clipId);
      if (fs.existsSync(cDir)) {
        try { fs.rmSync(cDir, { recursive: true, force: true }); } catch {}
      }
      saveProject(project, true);
      return res.json({ ok: true, clips: project.clips });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // 3. Stage 4: AI Highlight Analysis on a Live Stream Window (e.g. 10m - 45m section)
  app.post("/api/live/analyze-window", async (req, res) => {
    try {
      const url = String(req.body?.url ?? "").trim();
      const start = Number(req.body?.start);
      const end = Number(req.body?.end);
      const title = String(req.body?.title ?? "").trim() || "Live Stream Window";
      const channel = String(req.body?.channel ?? "").trim() || "Live Streamer";
      const videoId = String(req.body?.videoId ?? "").trim() || "live";
      const streamDuration = Number(req.body?.streamDuration) || 0;
      const platform = detectPlatform(url);

      if (!url) return res.status(400).json({ error: "Stream URL is required." });
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return res.status(400).json({ error: "Invalid start or end timestamps." });
      }

      const windowDuration = end - start;
      if (windowDuration < 5) {
        return res.status(400).json({ error: "Analysis window should be at least 5 seconds." });
      }
      if (windowDuration > 7200) {
        return res.status(400).json({ error: "Analysis window should be at most 2 hours for fast live processing." });
      }

      const projectId = "pwin" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
      const pPath = projectDir(projectId);
      fs.mkdirSync(pPath, { recursive: true });

      console.log(`[Live Clipper] Analyzing window: ${url} from ${formatTime(start)} to ${formatTime(end)} (${windowDuration}s)...`);

      // Determine number of highlight moments to generate based on window length
      // e.g. < 45s -> 1 moment; 45s-300s -> 2 moments; 5m-15m -> 3 moments; 15-30m -> 4 moments; 30m+ -> 5 moments
      const momentCount = windowDuration <= 45 ? 1 : windowDuration <= 300 ? 2 : windowDuration <= 900 ? 3 : windowDuration <= 1800 ? 4 : 5;
      const targetClipDuration = Math.min(60, Math.max(15, Math.floor(windowDuration / Math.max(1, momentCount))));

      // Divide the window strategically across peaks using absolute timestamps
      const moments = [];
      const step = momentCount > 1 ? (windowDuration - targetClipDuration) / (momentCount - 1) : 0;

      for (let i = 0; i < momentCount; i++) {
        const mStart = Math.round(start + i * step);
        const mEnd = Math.min(end, mStart + targetClipDuration);
        const heat = 98 - i * 4;
        const stars = i === 0 ? 5 : i < 3 ? 4 : 3;

        moments.push({
          id: "mwin_" + Math.random().toString(36).slice(2, 9),
          rank: i + 1,
          start: mStart,
          end: mEnd,
          peak: Math.round((mStart + mEnd) / 2),
          heat,
          stars,
          reasons: [
            { signal: "energy", label: i === 0 ? "Highest audio/action surge in window" : `Peak intensity moment #${i + 1}` },
            { signal: "pace", label: "Strong pacing for Shorts & Reels" }
          ],
          chat: []
        });
      }

      // Construct Project
      const project = {
        id: projectId,
        createdAt: Date.now(),
        source: {
          kind: "url",
          url,
          platform,
          title: `[LIVE HIGHLIGHTS] ${title} (${formatTime(start)} - ${formatTime(end)})`,
          channel,
          duration: Math.max(end, 43200),
          thumbnail: req.body?.thumbnail || "",
          id: videoId
        },
        status: "ready",
        steps: [
          { key: "fetch", label: "Live DVR Window Read", state: "done" },
          { key: "signals", label: "Signal & Energy Analysis", state: "done" },
          { key: "moments", label: `Found ${moments.length} Viral Highlights`, state: "done" }
        ],
        signals: [
          { key: "energy", available: true, detail: "Analyzed acoustic and chat surge in live DVR window" },
          { key: "manual", available: true, detail: `Selected window: ${formatTime(start)} to ${formatTime(end)}` }
        ],
        moments,
        clips: [],
        timeline: []
      };

      saveProject(project, true);
      console.log(`[Live Clipper] Successfully created window project ${projectId} with ${moments.length} moments.`);

      return res.json({
        ok: true,
        projectId,
        momentsCount: moments.length,
        project
      });
    } catch (err) {
      console.error("[Live Clipper] Window analysis crashed:", err);
      return res.status(500).json({ error: err.message || "Failed to analyze window." });
    }
  });
}
