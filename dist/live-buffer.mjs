// dist/live-buffer.mjs
// Managed rolling segment buffer service for active live streams (YouTube, Twitch, Kick)
// Ingests live streams into 4-second .ts segments with timeline-aligned metadata indexing,
// rolling retention window pruning, and frame-accurate local segment concatenation.

import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

export class LiveBufferSession {
  constructor({ id, url, streamInfo = {}, cacheDir, ytDlpRunner, getBinPath, retentionMinutes = 30 }) {
    this.id = id;
    this.url = String(url || "").trim();
    this.streamInfo = streamInfo || {};
    this.cacheDir = cacheDir;
    this.dir = path.join(cacheDir, id);
    this.ytDlpRunner = ytDlpRunner;
    this.getBinPath = getBinPath;
    this.retentionSeconds = Math.max(300, (retentionMinutes || 30) * 60);
    this.status = "idle"; // "starting" | "buffering" | "error" | "stopped"
    this.error = null;
    this.ffmpegProc = null;
    this.pollTimer = null;
    this.segments = []; // Array of { file, path, index, start, end, duration, size, createdAt }
    this.lastActivity = Date.now();
    this.inactivityTimeoutMs = 15 * 60 * 1000; // 15 mins of inactivity
    this.baseTimelineTime = 0;
    this.directStreamUrl = null;
    this.retryCount = 0;
    this.maxRetries = 5;
    this.isStopping = false;
  }

  // Calculate base timeline reference
  initTimelineReference() {
    const info = this.streamInfo;
    const nowSec = Math.floor(Date.now() / 1000);
    if (info.releaseTimestamp && info.releaseTimestamp > 1e9) {
      this.baseTimelineTime = Math.max(0, nowSec - info.releaseTimestamp);
    } else if (Number.isFinite(info.duration) && info.duration > 0) {
      this.baseTimelineTime = Number(info.duration);
    } else {
      this.baseTimelineTime = 0;
    }
    console.log(`[LiveBuffer:${this.id}] Initialized timeline reference clock at ${this.baseTimelineTime.toFixed(1)}s`);
  }

  async resolveStreamUrl() {
    // If masterM3u8 already provided in streamInfo (e.g. Kick)
    if (this.streamInfo.masterM3u8 && typeof this.streamInfo.masterM3u8 === "string" && this.streamInfo.masterM3u8.startsWith("http")) {
      return this.streamInfo.masterM3u8;
    }

    if (!this.ytDlpRunner) {
      throw new Error("yt-dlp runner dependency not available for live buffer ingest");
    }

    console.log(`[LiveBuffer:${this.id}] Resolving stream URL via yt-dlp...`);
    const flags = [
      "--no-warnings",
      "--js-runtimes", "node",
      "--extractor-args", "youtube:player_client=android,web;formats=incomplete",
      "-g",
      "-f", "bv*[protocol^=m3u8]+ba[protocol^=m3u8]/b[protocol^=m3u8]/bv*+ba/b/best",
      this.url
    ];

    const res = await this.ytDlpRunner(flags, { timeout: 35e3 });
    if (res.code !== 0 || !res.stdout.trim()) {
      throw new Error("Could not resolve live stream manifest: " + (res.stderr || "Unknown error"));
    }

    const lines = res.stdout.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith("http"));
    if (lines.length === 0) {
      throw new Error("No valid HTTP stream URLs found");
    }

    // In HLS / progressive streams, first URL is video/master
    return lines[0];
  }

  async start() {
    if (this.status === "buffering" || this.status === "starting") return;
    this.isStopping = false;
    this.status = "starting";
    this.error = null;
    this.touch();

    this.initTimelineReference();

    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }

    try {
      this.directStreamUrl = await this.resolveStreamUrl();
      this.spawnIngestProcess();
      this.startPolling();
    } catch (err) {
      this.status = "error";
      this.error = err.message;
      console.warn(`[LiveBuffer:${this.id}] Start error:`, err.message);
    }
  }

  spawnIngestProcess() {
    if (this.isStopping) return;

    const ffmpegBin = (typeof this.getBinPath === "function" ? this.getBinPath("ffmpeg") : null) || "ffmpeg";
    const segmentPattern = path.join(this.dir, "seg_%06d.ts");
    const listPath = path.join(this.dir, "segments.csv");

    const ffArgs = [
      "-hide_banner",
      "-loglevel", "warning",
      "-reconnect", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      "-i", this.directStreamUrl,
      "-c", "copy",
      "-f", "segment",
      "-segment_time", "4",
      "-reset_timestamps", "1",
      "-segment_list", listPath,
      "-segment_list_type", "csv",
      "-segment_list_flags", "+live",
      "-y",
      segmentPattern
    ];

    console.log(`[LiveBuffer:${this.id}] Spawning FFmpeg ingest process into ${this.dir}...`);
    this.ffmpegProc = spawn(ffmpegBin, ffArgs);
    this.status = "buffering";

    let errBuffer = "";
    this.ffmpegProc.stderr.on("data", (d) => {
      errBuffer += d.toString();
      if (errBuffer.length > 2000) errBuffer = errBuffer.slice(-2000);
    });

    this.ffmpegProc.on("close", (code) => {
      console.log(`[LiveBuffer:${this.id}] FFmpeg ingest exited with code ${code}`);
      this.ffmpegProc = null;

      if (!this.isStopping && this.status !== "stopped") {
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          console.log(`[LiveBuffer:${this.id}] Ingest connection dropped. Reconnecting in 3s (attempt ${this.retryCount}/${this.maxRetries})...`);
          setTimeout(async () => {
            if (this.isStopping) return;
            try {
              // Refresh stream URL in case token expired
              this.directStreamUrl = await this.resolveStreamUrl();
              this.spawnIngestProcess();
            } catch (rErr) {
              console.warn(`[LiveBuffer:${this.id}] Reconnect failed:`, rErr.message);
            }
          }, 3000);
        } else {
          this.status = "error";
          this.error = "Live ingest stream ended or disconnected: " + errBuffer.slice(-200);
        }
      }
    });

    this.ffmpegProc.on("error", (err) => {
      console.warn(`[LiveBuffer:${this.id}] FFmpeg process error:`, err.message);
      this.status = "error";
      this.error = err.message;
    });
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      this.pollSegments();
      this.pruneExpiredSegments();
    }, 1000);
  }

  pollSegments() {
    if (this.isStopping) return;
    const listPath = path.join(this.dir, "segments.csv");

    if (fs.existsSync(listPath)) {
      try {
        const content = fs.readFileSync(listPath, "utf8");
        const lines = content.trim().split(/\r?\n/).filter(Boolean);
        const indexed = [];

        for (const line of lines) {
          const parts = line.split(",");
          if (parts.length >= 3) {
            const filename = parts[0].trim();
            const relStart = parseFloat(parts[1]);
            const relEnd = parseFloat(parts[2]);

            if (!isNaN(relStart) && !isNaN(relEnd)) {
              const segPath = path.join(this.dir, filename);
              if (fs.existsSync(segPath)) {
                let size = 0;
                try { size = fs.statSync(segPath).size; } catch {}
                if (size > 1000) {
                  const segStart = this.baseTimelineTime + relStart;
                  const segEnd = this.baseTimelineTime + relEnd;
                  const idxMatch = filename.match(/seg_(\d+)\.ts/);
                  const segIdx = idxMatch ? parseInt(idxMatch[1], 10) : indexed.length;

                  indexed.push({
                    file: filename,
                    path: segPath,
                    index: segIdx,
                    start: segStart,
                    end: segEnd,
                    duration: Math.max(0.1, segEnd - segStart),
                    size
                  });
                }
              }
            }
          }
        }

        if (indexed.length > 0) {
          this.segments = indexed;
          this.status = "buffering";
        }
      } catch (e) {
        // Ignored, file might be writing
      }
    } else {
      // Fallback: poll .ts files directly in directory
      try {
        const files = fs.readdirSync(this.dir).filter(f => f.startsWith("seg_") && f.endsWith(".ts")).sort();
        if (files.length > 0) {
          const indexed = [];
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const p = path.join(this.dir, f);
            let size = 0;
            try { size = fs.statSync(p).size; } catch {}
            if (size > 1000) {
              const segStart = this.baseTimelineTime + (i * 4.0);
              const segEnd = segStart + 4.0;
              indexed.push({
                file: f,
                path: p,
                index: i,
                start: segStart,
                end: segEnd,
                duration: 4.0,
                size
              });
            }
          }
          if (indexed.length > 0) {
            this.segments = indexed;
            this.status = "buffering";
          }
        }
      } catch {}
    }
  }

  pruneExpiredSegments() {
    if (this.segments.length < 5) return;
    const latestEnd = this.segments[this.segments.length - 1].end;
    const cutoff = latestEnd - this.retentionSeconds;

    const remaining = [];
    let prunedCount = 0;

    for (const seg of this.segments) {
      if (seg.end < cutoff) {
        prunedCount++;
        try {
          if (fs.existsSync(seg.path)) fs.unlinkSync(seg.path);
        } catch {}
      } else {
        remaining.push(seg);
      }
    }

    if (prunedCount > 0) {
      this.segments = remaining;
      console.log(`[LiveBuffer:${this.id}] Pruned ${prunedCount} expired segments. Current active window: [${this.segments[0]?.start.toFixed(1)}s, ${latestEnd.toFixed(1)}s]`);
    }
  }

  getBounds() {
    if (this.segments.length === 0) {
      return {
        bufferStart: this.baseTimelineTime,
        bufferEnd: this.baseTimelineTime,
        bufferedSeconds: 0,
        segmentsCount: 0
      };
    }
    const bufferStart = this.segments[0].start;
    const bufferEnd = this.segments[this.segments.length - 1].end;
    return {
      bufferStart,
      bufferEnd,
      bufferedSeconds: Math.max(0, bufferEnd - bufferStart),
      segmentsCount: this.segments.length
    };
  }

  isRangeCovered(from, to) {
    if (this.segments.length === 0) return false;
    const bounds = this.getBounds();
    // Allow up to 3s tolerance at segment boundaries
    return from >= bounds.bufferStart - 3.0 && to <= bounds.bufferEnd + 3.0;
  }

  getSegmentsInRange(from, to) {
    return this.segments.filter(s => s.end > from - 1.0 && s.start < to + 1.0);
  }

  async sliceRange(from, to, outputFile) {
    this.touch();
    const matched = this.getSegmentsInRange(from, to);
    if (!matched || matched.length === 0) {
      throw new Error(`Requested range [${from}s, ${to}s] is outside buffered segments`);
    }

    const firstSeg = matched[0];
    const relativeStart = Math.max(0, from - firstSeg.start);
    const clipDuration = Math.max(0.5, to - from);

    console.log(`[LiveBuffer:${this.id}] Slicing range [${from.toFixed(2)}s - ${to.toFixed(2)}s] from ${matched.length} local segments (relStart: ${relativeStart.toFixed(2)}s, dur: ${clipDuration.toFixed(2)}s)...`);

    const concatTxtFile = path.join(this.dir, `concat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);
    const fileEntries = matched.map(s => `file '${s.path.replace(/\\/g, "/")}'`).join("\n") + "\n";
    fs.writeFileSync(concatTxtFile, fileEntries);

    const ffmpegBin = (typeof this.getBinPath === "function" ? this.getBinPath("ffmpeg") : null) || "ffmpeg";

    // Frame-accurate extraction with high quality clean re-encoding
    const ffArgs = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatTxtFile,
      "-ss", relativeStart.toFixed(3),
      "-t", clipDuration.toFixed(3),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputFile
    ];

    const p = spawn(ffmpegBin, ffArgs);
    let ffErr = "";
    p.stderr.on("data", d => ffErr += d.toString());

    try {
      await new Promise((resolve, reject) => {
        p.on("close", code => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg concat slice failed (exit ${code}): ${ffErr.slice(-300)}`));
        });
        p.on("error", reject);
      });
    } finally {
      try { if (fs.existsSync(concatTxtFile)) fs.unlinkSync(concatTxtFile); } catch {}
    }

    if (fs.existsSync(outputFile) && fs.statSync(outputFile).size >= 5000) {
      console.log(`[LiveBuffer:${this.id}] Frame-accurate slice succeeded: ${outputFile} (${fs.statSync(outputFile).size} bytes)`);
      return { ok: true, file: outputFile, duration: clipDuration };
    }

    throw new Error("FFmpeg completed but output file is missing or empty");
  }

  getStatus() {
    const bounds = this.getBounds();
    return {
      sessionId: this.id,
      url: this.url,
      status: this.status,
      error: this.error,
      baseTimelineTime: this.baseTimelineTime,
      bufferStart: bounds.bufferStart,
      bufferEnd: bounds.bufferEnd,
      bufferedSeconds: bounds.bufferedSeconds,
      segmentsCount: bounds.segmentsCount,
      retentionSeconds: this.retentionSeconds,
      lastActivity: this.lastActivity
    };
  }

  touch() {
    this.lastActivity = Date.now();
  }

  stop() {
    this.isStopping = true;
    this.status = "stopped";
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.ffmpegProc) {
      try {
        this.ffmpegProc.kill("SIGKILL");
      } catch {}
      this.ffmpegProc = null;
    }
    try {
      if (fs.existsSync(this.dir)) {
        fs.rmSync(this.dir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn(`[LiveBuffer:${this.id}] Directory cleanup notice:`, e.message);
    }
    console.log(`[LiveBuffer:${this.id}] Session buffer stopped and cleaned up.`);
  }
}

export class LiveBufferManager {
  constructor(deps = {}) {
    this.sessions = new Map();
    this.deps = deps;
    this.cacheDir = path.resolve("data/cache/live-buffers");
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    // Inactivity sweep every 60s
    this.sweeperInterval = setInterval(() => {
      this.sweepInactiveSessions();
    }, 60 * 1000);
  }

  createSessionId(url) {
    const hash = crypto.createHash("md5").update(String(url || "").trim().toLowerCase()).digest("hex").slice(0, 12);
    return `lbs_${hash}`;
  }

  getOrCreateSession({ url, streamInfo = {}, quality = "best", retentionMinutes = 30 }) {
    const sessionId = this.createSessionId(url);
    let session = this.sessions.get(sessionId);
    if (session) {
      session.touch();
      if (streamInfo && Object.keys(streamInfo).length > 0) {
        session.streamInfo = { ...session.streamInfo, ...streamInfo };
      }
      return session;
    }

    session = new LiveBufferSession({
      id: sessionId,
      url,
      streamInfo,
      cacheDir: this.cacheDir,
      ytDlpRunner: this.deps.ytDlpRunner,
      getBinPath: this.deps.getBinPath,
      retentionMinutes
    });

    this.sessions.set(sessionId, session);
    session.start().catch(err => {
      console.warn(`[LiveBufferManager] Failed to start session ${sessionId}:`, err.message);
    });

    return session;
  }

  getSession(sessionId) {
    const s = this.sessions.get(sessionId);
    if (s) s.touch();
    return s || null;
  }

  findSessionByUrl(url) {
    const sessionId = this.createSessionId(url);
    return this.getSession(sessionId);
  }

  stopSession(sessionIdOrUrl) {
    let session = this.sessions.get(sessionIdOrUrl);
    if (!session) {
      session = this.findSessionByUrl(sessionIdOrUrl);
    }
    if (session) {
      session.stop();
      this.sessions.delete(session.id);
      return true;
    }
    return false;
  }

  sweepInactiveSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActivity > session.inactivityTimeoutMs) {
        console.log(`[LiveBufferManager] Auto-pruning inactive buffer session ${id} (inactive for ${Math.round((now - session.lastActivity) / 60000)}m)`);
        session.stop();
        this.sessions.delete(id);
      }
    }
  }

  stopAll() {
    if (this.sweeperInterval) clearInterval(this.sweeperInterval);
    for (const session of this.sessions.values()) {
      session.stop();
    }
    this.sessions.clear();
  }
}
