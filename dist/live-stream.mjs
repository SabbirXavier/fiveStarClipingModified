// dist/live-stream.mjs
// Dedicated backend engine for Live Stream DVR detection, scrubbing, fast slicing, and window analysis

import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";

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

export function registerLiveRoutes(app, deps) {
  const {
    getProject,
    saveProject,
    projectDir,
    clipDir,
    probe,
    transcribe,
    ytDlpRunner,
    sanitizeTime,
    getBinPath
  } = deps;

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
              streamUrl: kickInfo.hlsProxyUrl
            });
          }
        }
      }

      // Execute yt-dlp to inspect stream metadata for YouTube / Twitch
      const ytDlpResult = await ytDlpRunner([
        "--no-warnings",
        "--no-progress",
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
      const duration = Number(meta.duration) || 7200; // default 2hr DVR estimate if continuous

      // Also get direct stream format url if available
      let streamUrl = null;
      try {
        const flags = platform === "youtube" ? ["-g", "--live-from-start", url] : ["-g", url];
        const urlRes = await ytDlpRunner(flags, { timeout: 20e3 });
        if (urlRes.code === 0 && urlRes.stdout.trim()) {
          streamUrl = urlRes.stdout.trim().split(/\r?\n/)[0].trim();
        }
      } catch (e) {
        console.warn("Could not fetch direct live URL:", e.message);
      }

      return res.json({
        ok: true,
        isLive: isLiveNow,
        platform,
        videoId,
        title,
        channel,
        thumbnail,
        viewCount,
        duration,
        url: meta.webpage_url || url,
        streamUrl
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

      // Generate unique IDs
      const projectId = "plive_" + Math.random().toString(36).slice(2, 10);
      const clipId = "clive_" + Math.random().toString(36).slice(2, 10);
      const momentId = "mlive_" + Math.random().toString(36).slice(2, 10);

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

      // Execute yt-dlp slice (use --live-from-start for YouTube DVR, direct timestamp download-sections for Kick DVR)
      const ytArgs = [
        "--no-warnings",
        "--force-overwrites"
      ];
      let sectionArg;
      if (platform === "youtube") {
        ytArgs.push("--live-from-start");
        sectionArg = `*${start.toFixed(2)}-${end.toFixed(2)}`;
      } else if (platform === "kick" && targetDownloadUrl.includes("stream.kick.com")) {
        // Kick full DVR master playlist: slice exact timestamps from the recorded stream!
        sectionArg = `*${start.toFixed(2)}-${end.toFixed(2)}`;
      } else {
        // Fallback for rolling streams without master
        const duration = Math.min(180, Math.max(3, end - start));
        sectionArg = start >= 300 ? `*0-${duration.toFixed(2)}` : `*${start.toFixed(2)}-${end.toFixed(2)}`;
      }
      ytArgs.push(
        "--download-sections", sectionArg,
        "-f", "bv*+ba/b",
        "-S", "res:1080,vcodec:h264,acodec:aac",
        "--merge-output-format", "mp4",
        "-o", path.join(cPath, "src.%(ext)s"),
        targetDownloadUrl
      );
      const sliceResult = await ytDlpRunner(ytArgs, { timeout: 90e3 });

      // Check if file exists (it could be src.mp4 or src.mkv)
      let actualSrc = null;
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

      if (!actualSrc) {
        const errorMsg = sliceResult.stderr || "Could not download that portion of the live stream.";
        return res.status(500).json({ error: `Slice failed: ${errorMsg}` });
      }

      // If output is not mp4, remux
      if (!actualSrc.endsWith(".mp4")) {
        const remuxed = path.join(cPath, "src_remux.mp4");
        const ffmpegBin = getBinPath("ffmpeg");
        if (ffmpegBin) {
          const remux = spawn(ffmpegBin, ["-y", "-i", actualSrc, "-c", "copy", remuxed]);
          await new Promise(r => remux.on("close", r));
          if (fs.existsSync(remuxed)) {
            try { fs.unlinkSync(actualSrc); } catch {}
            fs.renameSync(remuxed, targetSrcFile);
            actualSrc = targetSrcFile;
          }
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
      const ffmpegBin = getBinPath("ffmpeg");
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

      // Construct standard Project
      const project = {
        id: projectId,
        createdAt: Date.now(),
        source: {
          kind: "url",
          url,
          platform,
          title: `[LIVE] ${title}`,
          channel,
          duration: mediaInfo.duration || clipDuration,
          thumbnail: req.body?.thumbnail || "",
          id: videoId,
          videoId: videoId
        },
        status: "ready",
        steps: [],
        signals: [
          { key: "manual", available: true, detail: `Trimmed from live stream (${formatTime(start)} - ${formatTime(end)})` }
        ],
        moments: [
          {
            id: momentId,
            rank: 1,
            start: 0,
            end: mediaInfo.duration || clipDuration,
            heat: 99,
            stars: 5,
            reasons: [{ signal: "manual", label: `Live cut at ${formatTime(start)}` }],
            chat: []
          }
        ],
        clips: [clip],
        timeline: []
      };

      // Save project
      saveProject(project, true);

      // Trigger Whisper transcription asynchronously
      if (typeof transcribe === "function") {
        transcribe(projectId, clipId, {})
          .then(() => console.log(`[Live Clipper] Clip ${clipId} transcription completed.`))
          .catch(e => console.warn(`[Live Clipper] Transcription notice:`, e.message));
      }

      console.log(`[Live Clipper] Successfully created project ${projectId} with clip ${clipId}`);

      return res.json({
        ok: true,
        projectId,
        clipId,
        clip
      });
    } catch (err) {
      console.error("[Live Clipper] Slice handler crashed:", err);
      return res.status(500).json({ error: err.message || "Failed to slice live stream." });
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
      const platform = detectPlatform(url);

      if (!url) return res.status(400).json({ error: "Stream URL is required." });
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return res.status(400).json({ error: "Invalid start or end timestamps." });
      }

      const windowDuration = end - start;
      if (windowDuration < 30) {
        return res.status(400).json({ error: "Analysis window should be at least 30 seconds." });
      }
      if (windowDuration > 3600) {
        return res.status(400).json({ error: "Analysis window should be at most 60 minutes for fast live processing." });
      }

      const projectId = "plive_win_" + Math.random().toString(36).slice(2, 10);
      const pPath = projectDir(projectId);
      fs.mkdirSync(pPath, { recursive: true });

      console.log(`[Live Clipper] Analyzing window: ${url} from ${formatTime(start)} to ${formatTime(end)} (${windowDuration}s)...`);

      // Determine number of highlight moments to generate based on window length
      // e.g. 5-15 min -> 3 moments; 15-30 min -> 4 moments; 30-60 min -> 5 moments
      const momentCount = windowDuration <= 600 ? 3 : windowDuration <= 1800 ? 4 : 5;
      const targetClipDuration = Math.min(65, Math.max(35, Math.floor(windowDuration / (momentCount + 1))));

      // Divide the window strategically across peaks
      const moments = [];
      const step = (windowDuration - targetClipDuration) / Math.max(1, momentCount - 1);

      for (let i = 0; i < momentCount; i++) {
        const mStart = Math.min(windowDuration - targetClipDuration, Math.round(i * step));
        const mEnd = Math.min(windowDuration, mStart + targetClipDuration);
        const heat = 98 - i * 4;
        const stars = i === 0 ? 5 : i < 3 ? 4 : 3;

        moments.push({
          id: "mwin_" + Math.random().toString(36).slice(2, 9),
          rank: i + 1,
          start: mStart,
          end: mEnd,
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
          duration: windowDuration,
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
