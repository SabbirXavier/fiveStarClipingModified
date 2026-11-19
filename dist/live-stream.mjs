// dist/live-stream.mjs
// Dedicated backend engine for Live Stream DVR detection, scrubbing, and fast slicing

import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

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

  // 1. Check live stream info and get direct manifest
  app.post("/api/live/info", async (req, res) => {
    try {
      const url = String(req.body?.url ?? "").trim();
      if (!url) {
        return res.status(400).json({ error: "Please provide a valid stream URL." });
      }

      // Execute yt-dlp to inspect stream metadata
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
        const urlRes = await ytDlpRunner(["-g", "--live-from-start", url], { timeout: 20e3 });
        if (urlRes.code === 0 && urlRes.stdout.trim()) {
          streamUrl = urlRes.stdout.trim().split(/\r?\n/)[0].trim();
        }
      } catch (e) {
        console.warn("Could not fetch direct live URL:", e.message);
      }

      return res.json({
        ok: true,
        isLive: isLiveNow,
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

  // 2. Slice specific DVR window and create standard Fivestar project & clip
  app.post("/api/live/slice", async (req, res) => {
    try {
      const url = String(req.body?.url ?? "").trim();
      const start = Number(req.body?.start);
      const end = Number(req.body?.end);
      const title = String(req.body?.title ?? "").trim() || "Live Clip";
      const channel = String(req.body?.channel ?? "").trim() || "Live Streamer";
      const videoId = String(req.body?.videoId ?? "").trim() || "live";

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

      console.log(`[Live Clipper] Slicing stream: ${url} from ${start.toFixed(2)}s to ${end.toFixed(2)}s into ${targetSrcFile}...`);

      // Execute yt-dlp slice with --live-from-start
      const sliceResult = await ytDlpRunner([
        "--no-warnings",
        "--force-overwrites",
        "--live-from-start",
        "--download-sections", `*${start.toFixed(2)}-${end.toFixed(2)}`,
        "-f", "bv*+ba/b",
        "-S", "res:1080,vcodec:h264,acodec:aac",
        "--merge-output-format", "mp4",
        "-o", path.join(cPath, "src.%(ext)s"),
        url
      ], { timeout: 90e3 });

      // Check if file exists (it could be src.mp4 or src.mkv)
      let actualSrc = null;
      if (fs.existsSync(targetSrcFile) && fs.statSync(targetSrcFile).size >= 5000) {
        actualSrc = targetSrcFile;
      } else {
        // Check for other extensions
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

      // If output is not mp4, rename or remux
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
          platform: "youtube",
          title: `[LIVE] ${title}`,
          channel,
          duration: mediaInfo.duration || clipDuration,
          thumbnail: req.body?.thumbnail || "",
          id: videoId
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
}
