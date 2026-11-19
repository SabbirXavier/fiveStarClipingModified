// dist/web/assets/live-trim-ui.js
// Universal Trim Slider, Real-Time Video Sync, Multi-Platform Player, and Live Clipper UI

export function createLiveTrimComponents({ React, jsx, jsxs, Fragment, api, router, toast }) {
  const { useState, useEffect, useRef, useCallback } = React;

  // Format seconds to mm:ss or hh:mm:ss
  function formatSec(seconds, showHours = false) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = String(s % 60).padStart(2, "0");
    return h > 0 || showHours ? `${h}:${String(m).padStart(2, "0")}:${rem}` : `${m}:${rem}`;
  }

  // Parse mm:ss or hh:mm:ss or decimal seconds
  function parseSec(str) {
    if (typeof str === "number") return str;
    if (!str || typeof str !== "string") return NaN;
    const parts = str.trim().split(":").map(Number);
    if (!parts.length || parts.some(p => !Number.isFinite(p) || p < 0)) return NaN;
    return parts.reduce((acc, val) => acc * 60 + val, 0);
  }

  // Helper to sync video player or iframe playback time
  function seekActivePlayers(timeInSec) {
    try {
      // 1. Seek native HTML5 video elements (supports live & DVR HLS video)
      const videos = document.querySelectorAll("video");
      videos.forEach(v => {
        try {
          v.currentTime = Math.max(0, timeInSec);
        } catch {}
      });

      // 2. Seek YouTube iframes via postMessage API
      const iframes = document.querySelectorAll("iframe");
      iframes.forEach(iframe => {
        try {
          iframe.contentWindow?.postMessage(JSON.stringify({
            event: "command",
            func: "seekTo",
            args: [timeInSec, true]
          }), "*");
        } catch {}
      });
    } catch {}
  }

  // Helper to control playback (play / pause)
  function setPlayerPlayback(shouldPlay) {
    try {
      const videos = document.querySelectorAll("video");
      videos.forEach(v => {
        try {
          if (shouldPlay) v.play();
          else v.pause();
        } catch {}
      });

      const iframes = document.querySelectorAll("iframe");
      iframes.forEach(iframe => {
        try {
          iframe.contentWindow?.postMessage(JSON.stringify({
            event: "command",
            func: shouldPlay ? "playVideo" : "pauseVideo",
            args: []
          }), "*");
        } catch {}
      });
    } catch {}
  }

  // Ensure CSS is injected
  if (typeof document !== "undefined" && !document.getElementById("live-trim-styles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "live-trim-styles";
    styleEl.textContent = `
      .universal-trim-box {
        margin: 20px 0;
        padding: 18px 20px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 14px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.25);
        backdrop-filter: blur(12px);
      }
      .trim-preview-player-wrap {
        width: 100%;
        aspect-ratio: 16 / 9;
        max-height: 420px;
        background: #000;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        overflow: hidden;
        margin-bottom: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        display: flex;
        flex-direction: column;
      }
      .preview-header-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 14px;
        background: rgba(15, 15, 20, 0.95);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        font-size: 13px;
        flex-shrink: 0;
      }
      .preview-title-badge {
        font-weight: 700;
        color: #c084fc;
        letter-spacing: 0.3px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .preview-time-badge {
        font-weight: 600;
        color: #e4e4e7;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        background: rgba(255, 255, 255, 0.08);
        padding: 2px 8px;
        border-radius: 4px;
      }
      .trim-preview-player-wrap video,
      .trim-preview-player-wrap iframe {
        width: 100%;
        height: 100%;
        flex: 1;
        border: none;
        display: block;
      }
      .hls-video-container {
        position: relative;
        width: 100%;
        height: 100%;
        flex: 1;
        background: #000;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .hls-video-element {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #000;
      }
      .hls-loading-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.7);
        color: #e4e4e7;
        font-size: 14px;
        gap: 10px;
        z-index: 10;
        backdrop-filter: blur(4px);
      }
      .trim-top-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
        flex-wrap: wrap;
        gap: 12px;
      }
      .trim-title-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .trim-badge {
        background: linear-gradient(135deg, #7c3aed, #a855f7);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      .trim-slider-track-wrap {
        position: relative;
        height: 52px;
        background: rgba(0, 0, 0, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        user-select: none;
        touch-action: none;
        cursor: pointer;
        margin-bottom: 14px;
        overflow: hidden;
      }
      .trim-slider-track-wrap:hover {
        border-color: rgba(255, 255, 255, 0.22);
      }
      .trim-range-highlight {
        position: absolute;
        top: 0;
        bottom: 0;
        background: linear-gradient(90deg, rgba(124, 58, 237, 0.35), rgba(168, 85, 247, 0.45));
        border-top: 2px solid #a855f7;
        border-bottom: 2px solid #a855f7;
        pointer-events: none;
      }
      .trim-handle {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 18px;
        margin-left: -9px;
        background: #ffffff;
        border: 2px solid #a855f7;
        border-radius: 6px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5), 0 0 12px rgba(168,85,247,0.4);
        cursor: ew-resize;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.08s ease;
      }
      .trim-handle:hover, .trim-handle.active {
        transform: scale(1.15);
        background: #fdf2f8;
      }
      .trim-handle::after {
        content: "";
        width: 3px;
        height: 18px;
        background: #7c3aed;
        border-radius: 2px;
      }
      .trim-playhead {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        margin-left: -1px;
        background: #38bdf8;
        box-shadow: 0 0 8px #38bdf8;
        z-index: 8;
        pointer-events: none;
      }
      .trim-playhead-badge {
        position: absolute;
        top: 2px;
        left: 50%;
        transform: translateX(-50%);
        background: #0284c7;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        padding: 1px 4px;
        border-radius: 3px;
        white-space: nowrap;
      }
      .trim-controls-grid {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
      }
      .trim-inputs-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .trim-time-box {
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 8px;
        padding: 4px 8px;
      }
      .trim-time-box label {
        font-size: 12px;
        color: #a1a1aa;
        font-weight: 600;
      }
      .trim-time-input {
        width: 65px;
        background: transparent;
        border: none;
        color: #fff;
        font-family: inherit;
        font-size: 14px;
        font-weight: 700;
        text-align: center;
        outline: none;
      }
      .trim-btn-mini {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        color: #e4e4e7;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 8px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .trim-btn-mini:hover {
        background: rgba(255,255,255,0.14);
        color: #fff;
      }
      .trim-btn-active {
        background: rgba(168, 85, 247, 0.3) !important;
        border-color: #a855f7 !important;
        color: #fff !important;
      }
      .trim-duration-pill {
        font-size: 12px;
        font-weight: 600;
        color: #a1a1aa;
        background: rgba(255,255,255,0.05);
        padding: 4px 10px;
        border-radius: 20px;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .trim-duration-pill.good {
        color: #4ade80;
        border-color: rgba(74, 222, 128, 0.25);
      }
      .trim-duration-pill.warn {
        color: #f87171;
        border-color: rgba(248, 113, 113, 0.25);
      }
      /* Stream Moments 2-Column Layout & Info Card */
      .moments-layout {
        display: grid !important;
        grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) !important;
        align-items: start !important;
        gap: 24px !important;
        margin-top: 20px !important;
      }
      @media (max-width: 1100px) {
        .moments-layout {
          grid-template-columns: 1fr !important;
        }
      }
      .aside {
        display: flex !important;
        flex-direction: column !important;
        gap: 16px !important;
        width: 100% !important;
      }
      .moment-info-card {
        padding: 20px 22px;
        background: rgba(22, 16, 42, 0.75);
        border: 2px solid #22c55e;
        border-radius: 14px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .moment-info-card .aside-block {
        margin-bottom: 0;
      }
      .moment-info-card h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
        font-weight: 700;
        color: #ffffff;
        margin: 0 0 10px 0;
      }
      .moment-info-card .aside-divider {
        height: 1px;
        background: rgba(255, 255, 255, 0.1);
        margin: 4px 0;
      }

      /* Live Clipper Dedicated View */
      .live-clipper-container {
        max-width: 1040px;
        margin: 0 auto;
        padding: 24px 20px 60px;
      }
      .live-header-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
        flex-wrap: wrap;
        gap: 16px;
      }
      .live-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.3);
        padding: 4px 12px;
        border-radius: 20px;
        font-weight: 700;
        font-size: 12px;
        letter-spacing: 0.5px;
      }
      .live-dot {
        width: 8px;
        height: 8px;
        background: #ef4444;
        border-radius: 50%;
        animation: livePulse 1.5s infinite;
      }
      @keyframes livePulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.4); opacity: 0.5; }
      }
      .live-player-frame {
        width: 100%;
        aspect-ratio: 16 / 9;
        max-height: 520px;
        background: #000;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,0.1);
        overflow: hidden;
        margin-bottom: 20px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.6);
      }
      .live-player-frame iframe {
        width: 100%;
        height: 100%;
        border: none;
      }
      .live-clip-btn {
        background: linear-gradient(135deg, #7c3aed, #a855f7);
        color: #ffffff;
        font-weight: 700;
        font-size: 15px;
        padding: 12px 24px;
        border-radius: 10px;
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        transition: all 0.2s ease;
        box-shadow: 0 4px 18px rgba(124, 58, 237, 0.4);
      }
      .live-clip-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 24px rgba(124, 58, 237, 0.6);
      }
      .live-clip-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .live-success-card {
        margin-top: 24px;
        padding: 20px;
        background: rgba(34, 197, 94, 0.08);
        border: 1px solid rgba(34, 197, 94, 0.25);
        border-radius: 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        flex-wrap: wrap;
      }
      .recent-live-clips-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 16px;
        margin-top: 24px;
      }
      .recent-live-clip-item {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        padding: 12px;
        display: flex;
        gap: 12px;
        align-items: center;
      }
    `;
    document.head.appendChild(styleEl);
  }

  // ==========================================
  // COMPONENT: Native Scrubbable HLS DVR Video Player
  // Plays live and recorded HLS streams (Kick, Twitch, etc.)
  // ==========================================
  function HlsVideoPlayer({ src, startTime = 0, endTime = 0, title = "", isLive = false, onTimeUpdate }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [currTime, setCurrTime] = useState(startTime);
    const [isBuffering, setIsBuffering] = useState(false);

    // Initial setup with hls.js
    useEffect(() => {
      let isCancelled = false;
      const video = videoRef.current;
      if (!video || !src) return;

      setLoading(true);
      setError(null);

      function attachHls() {
        if (!window.Hls || !window.Hls.isSupported()) {
          // Native Safari / iOS HLS check
          if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = src;
            if (startTime > 0) video.currentTime = startTime;
            video.play().catch(() => {});
            setLoading(false);
            return;
          }
          setError("HLS stream playback not supported in this browser.");
          setLoading(false);
          return;
        }

        if (hlsRef.current) {
          try { hlsRef.current.destroy(); } catch {}
          hlsRef.current = null;
        }

        const hls = new window.Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 300,
          maxBufferLength: 60,
          maxMaxBufferLength: 600,
          liveSyncDurationCount: 3,
          startPosition: startTime > 0 ? startTime : -1
        });
        hlsRef.current = hls;

        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          if (isCancelled) return;
          setLoading(false);
          if (startTime > 0) {
            try { video.currentTime = startTime; } catch {}
          }
          video.play().catch(() => {});
        });

        hls.on(window.Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case window.Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case window.Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                setError("Stream playback error: " + (data.details || "Failed to load"));
                break;
            }
          }
        });
      }

      if (window.Hls) {
        attachHls();
      } else {
        // Load local /assets/hls.min.js
        const script = document.createElement("script");
        script.src = "/assets/hls.min.js";
        script.async = true;
        script.onload = () => {
          if (!isCancelled) attachHls();
        };
        script.onerror = () => {
          if (!isCancelled) setError("Could not load local HLS player engine.");
        };
        document.head.appendChild(script);
      }

      return () => {
        isCancelled = true;
        if (hlsRef.current) {
          try { hlsRef.current.destroy(); } catch {}
          hlsRef.current = null;
        }
      };
    }, [src]);

    // Update time listener
    const handleTimeUpdate = () => {
      const v = videoRef.current;
      if (!v) return;
      setCurrTime(v.currentTime);
      onTimeUpdate?.(v.currentTime);
    };

    return jsxs("div", {
      className: "hls-video-container",
      children: [
        loading && jsxs("div", {
          className: "hls-loading-overlay",
          children: [
            jsx("span", { style: { animation: "spin 1s linear infinite", fontSize: "24px" }, children: "⚡" }),
            jsx("span", { children: "Connecting to Kick DVR live stream..." })
          ]
        }),
        error && jsxs("div", {
          className: "hls-loading-overlay",
          style: { background: "rgba(127, 29, 29, 0.85)" },
          children: [
            jsx("span", { style: { fontSize: "24px" }, children: "⚠️" }),
            jsx("span", { children: error })
          ]
        }),
        jsx("video", {
          ref: videoRef,
          className: "hls-video-element",
          controls: true,
          autoPlay: true,
          playsInline: true,
          onTimeUpdate: handleTimeUpdate,
          onWaiting: () => setIsBuffering(true),
          onPlaying: () => setIsBuffering(false)
        })
      ]
    });
  }

  // ==========================================
  // COMPONENT: Universal Moment Video Player
  // Plays local videos, YouTube, Kick, and Twitch
  // ==========================================
  function MomentPreviewPlayer({ project, moment, startTime, endTime }) {
    if (!project) return null;

    const source = project.source || {};
    const platform = (source.platform || "").toLowerCase();
    const isFile = source.kind === "file";
    const start = Number.isFinite(startTime) ? startTime : (moment?.start || 0);
    const end = Number.isFinite(endTime) ? endTime : (moment?.end || start + 60);

    const header = jsxs("div", {
      className: "preview-header-bar",
      children: [
        jsxs("span", {
          className: "preview-title-badge",
          children: [
            jsx("span", { children: "▶" }),
            ` Previewing: Moment ${moment?.rank || 1}`
          ]
        }),
        jsx("span", {
          className: "preview-time-badge",
          children: `${formatSec(start)} → ${formatSec(end)} (${Math.round(end - start)}s)`
        })
      ]
    });

    // 1. If local file
    if (isFile && source.file) {
      const fileUrl = `/files/projects/${project.id}/${source.file}#t=${start.toFixed(1)},${end.toFixed(1)}`;
      return jsxs("div", {
        className: "trim-preview-player-wrap",
        children: [
          header,
          jsx("video", {
            key: `${project.id}_${start.toFixed(1)}_${end.toFixed(1)}`,
            controls: true,
            autoPlay: true,
            preload: "metadata",
            src: fileUrl
          })
        ]
      });
    }

    // 2. If Kick (Use native scrubbable HLS player)
    if (platform === "kick" || (source.url && source.url.includes("kick.com"))) {
      const channel = (source.channel || source.id || (source.url.match(/kick\.com\/([^/?#]+)/)?.[1] ?? "")).toLowerCase();
      const hlsUrl = `/api/live/kick-hls/${encodeURIComponent(channel)}/master.m3u8`;
      return jsxs("div", {
        className: "trim-preview-player-wrap",
        children: [
          header,
          jsx(HlsVideoPlayer, {
            key: `kick_hls_${channel}`,
            src: hlsUrl,
            startTime: start,
            endTime: end,
            title: `Kick: ${channel}`
          })
        ]
      });
    }

    // 3. If Twitch
    if (platform === "twitch" || (source.url && source.url.includes("twitch.tv"))) {
      const channel = (source.channel || (source.url.match(/twitch\.tv\/([^/?#]+)/)?.[1] ?? "")).toLowerCase();
      const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
      return jsxs("div", {
        className: "trim-preview-player-wrap",
        children: [
          header,
          jsx("iframe", {
            key: `twitch_${channel}`,
            src: `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${hostname}&autoplay=true&muted=false`,
            title: moment ? `Moment ${moment.rank || 1}` : "Twitch Stream Preview",
            allow: "autoplay; fullscreen; picture-in-picture",
            allowFullScreen: true
          })
        ]
      });
    }

    // 4. YouTube
    const videoId = source.videoId || source.id || (source.url ? (source.url.match(/(?:v=|\/embed\/|\/live\/|youtu\.be\/)([\w-]{11})/)?.[1] || "") : "");
    if (videoId) {
      return jsxs("div", {
        className: "trim-preview-player-wrap",
        children: [
          header,
          jsx("iframe", {
            key: `yt_${videoId}_${Math.floor(start)}_${Math.ceil(end)}`,
            src: `https://www.youtube.com/embed/${videoId}?start=${Math.floor(start)}&end=${Math.ceil(end)}&autoplay=1&enablejsapi=1&rel=0`,
            title: moment ? `Moment ${moment.rank || 1}` : "YouTube Preview",
            allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
            allowFullScreen: true
          })
        ]
      });
    }

    return null;
  }

  // ==========================================
  // COMPONENT 1: Universal Interactive Trim Slider
  // ==========================================
  function UniversalTrimSlider({
    project = null,
    moment = null,
    duration = 180,
    startTime = 0,
    endTime = 60,
    onTrimChange,
    onAddMoment,
    onApplyChanges,
    onSeek,
    isLive = false,
    addLabel = "Add moment",
    applyLabel = "Apply Changes",
    extraAction = null
  }) {
    const totalDuration = Math.max(10, duration);
    const [start, setStart] = useState(() => Math.max(0, Math.min(startTime, totalDuration - 3)));
    const [end, setEnd] = useState(() => Math.max(start + 3, Math.min(endTime || start + 60, totalDuration)));
    const [playhead, setPlayhead] = useState(() => start);
    const [dragging, setDragging] = useState(null);
    const [isPlayingLoop, setIsPlayingLoop] = useState(false);

    const trackRef = useRef(null);
    const loopTimerRef = useRef(null);

    // Sync when moment prop changes or selected
    useEffect(() => {
      if (moment) {
        const mStart = Number.isFinite(moment.start) ? moment.start : startTime;
        const mEnd = Number.isFinite(moment.end) ? moment.end : endTime;
        const s = Math.max(0, Math.min(mStart, totalDuration - 3));
        const e = Math.max(s + 3, Math.min(mEnd, totalDuration));
        setStart(s);
        setEnd(e);
        setPlayhead(s);
        seekActivePlayers(s);
      }
    }, [moment?.id, moment?.start, moment?.end]);

    // Sync external props if changed (and not actively dragging)
    useEffect(() => {
      if (Number.isFinite(startTime) && !dragging) {
        setStart(prev => (Math.abs(startTime - prev) > 0.1 ? Math.max(0, Math.min(startTime, totalDuration - 3)) : prev));
      }
    }, [startTime, totalDuration]);

    useEffect(() => {
      if (Number.isFinite(endTime) && !dragging) {
        setEnd(prev => (Math.abs(endTime - prev) > 0.1 ? Math.max(start + 3, Math.min(endTime, totalDuration)) : prev));
      }
    }, [endTime, totalDuration, start]);

    // Notify parent & sync players on change
    const updateTrim = useCallback((newStart, newEnd) => {
      const s = Math.max(0, Math.min(newStart, totalDuration - 1));
      const e = Math.max(s + 3, Math.min(newEnd, totalDuration));
      setStart(s);
      setEnd(e);
      if (typeof onTrimChange === "function") {
        onTrimChange({
          start: s,
          end: e,
          startFormatted: formatSec(s, totalDuration >= 3600),
          endFormatted: formatSec(e, totalDuration >= 3600),
          duration: e - s
        });
      }
    }, [totalDuration, onTrimChange]);

    const getTimeFromEvent = useCallback((e) => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * totalDuration;
    }, [totalDuration]);

    useEffect(() => {
      if (!dragging) return;

      const onPointerMove = (e) => {
        const time = getTimeFromEvent(e);
        if (dragging === "start") {
          const nextStart = Math.min(time, end - 3);
          updateTrim(nextStart, end);
          setPlayhead(nextStart);
          seekActivePlayers(nextStart);
          onSeek?.(nextStart);
        } else if (dragging === "end") {
          const nextEnd = Math.max(time, start + 3);
          updateTrim(start, nextEnd);
          setPlayhead(nextEnd);
          seekActivePlayers(nextEnd);
          onSeek?.(nextEnd);
        } else if (dragging === "playhead" || dragging === "track") {
          setPlayhead(time);
          seekActivePlayers(time);
          onSeek?.(time);
        }
      };

      const onPointerUp = () => {
        setDragging(null);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      return () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };
    }, [dragging, getTimeFromEvent, start, end, updateTrim, onSeek]);

    // Keyboard Shortcuts (I to set IN, O to set OUT)
    useEffect(() => {
      const onKeyDown = (e) => {
        if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
        if (e.key === "i" || e.key === "I") {
          e.preventDefault();
          updateTrim(playhead, Math.max(playhead + 3, end));
          toast?.("Marked IN point at " + formatSec(playhead));
        } else if (e.key === "o" || e.key === "O") {
          e.preventDefault();
          updateTrim(Math.min(playhead - 3, start), playhead);
          toast?.("Marked OUT point at " + formatSec(playhead));
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [playhead, start, end, updateTrim, toast]);

    // Loop Preview toggle
    const toggleLoopPreview = () => {
      if (isPlayingLoop) {
        clearInterval(loopTimerRef.current);
        setPlayerPlayback(false);
        setIsPlayingLoop(false);
      } else {
        seekActivePlayers(start);
        setPlayerPlayback(true);
        setIsPlayingLoop(true);

        const durationMs = Math.max(1000, (end - start) * 1000);
        clearInterval(loopTimerRef.current);
        loopTimerRef.current = setInterval(() => {
          seekActivePlayers(start);
        }, durationMs);
      }
    };

    useEffect(() => {
      return () => {
        if (loopTimerRef.current) clearInterval(loopTimerRef.current);
      };
    }, []);

    const clipDuration = Math.round((end - start) * 10) / 10;
    const isDurationGood = clipDuration >= 3 && clipDuration <= 180;

    const leftPercent = (start / totalDuration) * 100;
    const rightPercent = (end / totalDuration) * 100;
    const playheadPercent = (playhead / totalDuration) * 100;

    return jsx("div", {
      className: "universal-trim-box",
      children: jsxs(Fragment, {
        children: [
          // Inline Video Preview Player when project is provided
          project && jsx(MomentPreviewPlayer, {
            project,
            moment,
            startTime: start,
            endTime: end
          }),

          // Header Row
          jsxs("div", {
            className: "trim-top-row",
            children: [
              jsxs("div", {
                className: "trim-title-wrap",
                children: [
                  jsx("span", {
                    className: "trim-badge",
                    children: isLive ? "Live DVR Trim" : "Interactive Trim Slider"
                  }),
                  jsx("span", {
                    style: { fontSize: "13px", color: "#d4d4d8", fontWeight: 600 },
                    children: isLive ? "Scrub live DVR & drag handles to clip" : "Select moment above or drag handles below to adjust"
                  })
                ]
              }),
              jsxs("div", {
                className: `trim-duration-pill ${isDurationGood ? "good" : "warn"}`,
                children: [
                  "Clip Duration: ",
                  jsx("b", { children: `${clipDuration}s` }),
                  clipDuration > 180 ? " (Over 3m)" : clipDuration < 3 ? " (Min 3s)" : " (Ideal for Shorts & Reels)"
                ]
              })
            ]
          }),

          // Visual Timeline Track
          jsxs("div", {
            ref: trackRef,
            className: "trim-slider-track-wrap",
            onPointerDown: (e) => {
              const time = getTimeFromEvent(e);
              setPlayhead(time);
              seekActivePlayers(time);
              onSeek?.(time);
              setDragging("track");
            },
            children: [
              // Highlight band
              jsx("div", {
                className: "trim-range-highlight",
                style: {
                  left: `${leftPercent}%`,
                  width: `${Math.max(1, rightPercent - leftPercent)}%`
                }
              }),

              // Left Handle (IN)
              jsx("div", {
                className: `trim-handle trim-handle-start ${dragging === "start" ? "active" : ""}`,
                style: { left: `${leftPercent}%` },
                title: `Start: ${formatSec(start)} (Drag or press 'I')`,
                onPointerDown: (e) => {
                  e.stopPropagation();
                  setDragging("start");
                }
              }),

              // Right Handle (OUT)
              jsx("div", {
                className: `trim-handle trim-handle-end ${dragging === "end" ? "active" : ""}`,
                style: { left: `${rightPercent}%` },
                title: `End: ${formatSec(end)} (Drag or press 'O')`,
                onPointerDown: (e) => {
                  e.stopPropagation();
                  setDragging("end");
                }
              }),

              // Playhead Scrubber
              jsx("div", {
                className: "trim-playhead",
                style: { left: `${playheadPercent}%` },
                children: jsx("span", {
                  className: "trim-playhead-badge",
                  children: formatSec(playhead)
                })
              })
            ]
          }),

          // Controls Row
          jsxs("div", {
            className: "trim-controls-grid",
            children: [
              // Left: Start & End manual input / micro-adjust
              jsxs("div", {
                className: "trim-inputs-row",
                children: [
                  jsxs("div", {
                    className: "trim-time-box",
                    children: [
                      jsx("label", { children: "From" }),
                      jsx("input", {
                        className: "trim-time-input",
                        value: formatSec(start, totalDuration >= 3600),
                        onChange: (e) => {
                          const parsed = parseSec(e.target.value);
                          if (Number.isFinite(parsed)) updateTrim(parsed, end);
                        }
                      }),
                      jsx("button", {
                        type: "button",
                        className: "trim-btn-mini",
                        title: "Nudge back 1s",
                        onClick: () => {
                          updateTrim(start - 1, end);
                          seekActivePlayers(start - 1);
                        },
                        children: "-1s"
                      }),
                      jsx("button", {
                        type: "button",
                        className: "trim-btn-mini",
                        title: "Nudge forward 1s",
                        onClick: () => {
                          updateTrim(start + 1, end);
                          seekActivePlayers(start + 1);
                        },
                        children: "+1s"
                      })
                    ]
                  }),

                  jsxs("div", {
                    className: "trim-time-box",
                    children: [
                      jsx("label", { children: "To" }),
                      jsx("input", {
                        className: "trim-time-input",
                        value: formatSec(end, totalDuration >= 3600),
                        onChange: (e) => {
                          const parsed = parseSec(e.target.value);
                          if (Number.isFinite(parsed)) updateTrim(start, parsed);
                        }
                      }),
                      jsx("button", {
                        type: "button",
                        className: "trim-btn-mini",
                        title: "Nudge back 1s",
                        onClick: () => {
                          updateTrim(start, end - 1);
                          seekActivePlayers(end - 1);
                        },
                        children: "-1s"
                      }),
                      jsx("button", {
                        type: "button",
                        className: "trim-btn-mini",
                        title: "Nudge forward 1s",
                        onClick: () => {
                          updateTrim(start, end + 1);
                          seekActivePlayers(end + 1);
                        },
                        children: "+1s"
                      })
                    ]
                  })
                ]
              }),

              // Center: Quick Presets & Preview Loop
              jsxs("div", {
                style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" },
                children: [
                  jsx("button", {
                    type: "button",
                    className: `trim-btn-mini ${isPlayingLoop ? "trim-btn-active" : ""}`,
                    title: isPlayingLoop ? "Stop looping selection" : "Play selected range on repeat",
                    onClick: toggleLoopPreview,
                    children: isPlayingLoop ? "⏹ Stop Loop" : "🔁 Preview Loop"
                  }),
                  jsx("button", {
                    type: "button",
                    className: "trim-btn-mini",
                    title: "Set start to current playhead (Key: I)",
                    onClick: () => updateTrim(playhead, Math.max(playhead + 3, end)),
                    children: "Mark IN (I)"
                  }),
                  jsx("button", {
                    type: "button",
                    className: "trim-btn-mini",
                    title: "Set end to current playhead (Key: O)",
                    onClick: () => updateTrim(Math.min(playhead - 3, start), playhead),
                    children: "Mark OUT (O)"
                  }),
                  jsx("button", {
                    type: "button",
                    className: "trim-btn-mini",
                    title: "Set 30s duration",
                    onClick: () => updateTrim(start, start + 30),
                    children: "30s"
                  }),
                  jsx("button", {
                    type: "button",
                    className: "trim-btn-mini",
                    title: "Set 60s duration",
                    onClick: () => updateTrim(start, start + 60),
                    children: "60s"
                  })
                ]
              }),

              // Right: Action button(s)
              jsxs("div", {
                style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" },
                children: [
                  extraAction,
                  onApplyChanges && jsx("button", {
                    type: "button",
                    className: "btn btn-secondary",
                    style: {
                      minWidth: "130px",
                      background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                      color: "#ffffff",
                      border: "none",
                      fontWeight: 700,
                      cursor: "pointer",
                      boxShadow: "0 2px 10px rgba(34, 197, 94, 0.35)",
                      borderRadius: "8px",
                      padding: "8px 16px"
                    },
                    disabled: !isDurationGood,
                    onClick: () => {
                      onApplyChanges({ start, end, duration: clipDuration });
                    },
                    children: applyLabel
                  }),
                  jsx("button", {
                    type: "button",
                    className: "btn btn-primary",
                    style: { minWidth: "120px" },
                    disabled: !isDurationGood,
                    onClick: () => {
                      onAddMoment?.({ start, end, duration: clipDuration });
                    },
                    children: addLabel
                  })
                ]
              })
            ]
          })
        ]
      })
    });
  }

  // ==========================================
  // COMPONENT 2: Dedicated Live Stream Clipper Screen
  // ==========================================
  function LiveClipperView({ initialUrl = "" }) {
    const [urlInput, setUrlInput] = useState(initialUrl);
    const [streamInfo, setStreamInfo] = useState(null);
    const [loadingInfo, setLoadingInfo] = useState(false);
    const [trim, setTrim] = useState({ start: 0, end: 60, duration: 60 });
    const [isSlicing, setIsSlicing] = useState(false);
    const [sliceProgress, setSliceProgress] = useState("");
    const [lastCreatedClip, setLastCreatedClip] = useState(null);
    const [sessionClips, setSessionClips] = useState([]);
    const [useOfficialEmbed, setUseOfficialEmbed] = useState(false);

    const playerRef = useRef(null);

    // Auto-load if initial URL provided in query
    useEffect(() => {
      const hash = window.location.hash;
      const queryIdx = hash.indexOf("?");
      if (queryIdx !== -1) {
        const params = new URLSearchParams(hash.substring(queryIdx + 1));
        const passedUrl = params.get("url");
        if (passedUrl) {
          setUrlInput(passedUrl);
          fetchStreamInfo(passedUrl);
        }
      }
    }, []);

    const fetchStreamInfo = async (targetUrl) => {
      const u = (targetUrl || urlInput).trim();
      if (!u) return toast?.("Enter a live stream link first.", true);

      setLoadingInfo(true);
      setSliceProgress("Checking live stream details...");
      try {
        const res = await fetch("/api/live/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: u })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to inspect live stream.");

        setStreamInfo(data);
        const platform = (data.platform || "youtube").toLowerCase();
        const dur = data.duration || 7200;
        const initialStart = platform === "youtube" ? Math.max(0, dur - 60) : (platform === "kick" ? Math.max(0, dur - 60) : 0);
        const initialEnd = dur;
        const initialDuration = Math.min(60, Math.max(5, initialEnd - initialStart));
        setTrim({ start: initialStart, end: initialEnd, duration: initialDuration });
        toast?.(`Loaded stream: ${data.title}`);
      } catch (err) {
        toast?.(err.message, true);
      } finally {
        setLoadingInfo(false);
        setSliceProgress("");
      }
    };

    // Stage 2: Instant Slice & Transcribe Mode
    const handleCreateLiveClip = async () => {
      if (!streamInfo) return;
      if (trim.duration < 3 || trim.duration > 180) {
        return toast?.("Clips must be between 3 seconds and 3 minutes.", true);
      }

      setIsSlicing(true);
      setSliceProgress("Extracting live segment with FFmpeg & transcribing with Whisper (approx 5-8s)...");
      try {
        const res = await fetch("/api/live/slice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: streamInfo.url,
            masterM3u8: streamInfo.masterM3u8,
            start: trim.start,
            end: trim.end,
            title: streamInfo.title,
            channel: streamInfo.channel,
            videoId: streamInfo.videoId,
            thumbnail: streamInfo.thumbnail
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to slice live stream.");

        setLastCreatedClip(data);
        setSessionClips(prev => [data, ...prev]);
        toast?.("Live clip created successfully! Ready to edit.");
      } catch (err) {
        toast?.(err.message, true);
      } finally {
        setIsSlicing(false);
        setSliceProgress("");
      }
    };

    // Stage 4: AI Highlights in Window Mode
    const handleAnalyzeWindow = async () => {
      if (!streamInfo) return;
      setIsSlicing(true);
      setSliceProgress("Analyzing live DVR window for viral spikes & highlights...");
      try {
        const res = await fetch("/api/live/analyze-window", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: streamInfo.url,
            masterM3u8: streamInfo.masterM3u8,
            start: trim.start,
            end: trim.end,
            title: streamInfo.title,
            channel: streamInfo.channel,
            videoId: streamInfo.videoId,
            thumbnail: streamInfo.thumbnail
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to analyze live window.");

        toast?.(`Found ${data.momentsCount} viral moments in this window! Opening...`);
        window.location.hash = router.stream(data.projectId);
      } catch (err) {
        toast?.(err.message, true);
      } finally {
        setIsSlicing(false);
        setSliceProgress("");
      }
    };

    // Multi-Platform Player URL generator
    const getEmbedPlayerSrc = () => {
      if (!streamInfo) return "";
      const platform = (streamInfo.platform || "youtube").toLowerCase();
      if (platform === "kick") {
        const channel = (streamInfo.channel || streamInfo.url.match(/kick\.com\/([^/?#]+)/)?.[1] || "").toLowerCase();
        return `https://player.kick.com/${encodeURIComponent(channel)}?autoplay=true&muted=false`;
      }
      if (platform === "twitch") {
        const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
        const channel = (streamInfo.channel || streamInfo.url.match(/twitch\.tv\/([^/?#]+)/)?.[1] || "").toLowerCase();
        return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${hostname}&autoplay=true&muted=false`;
      }
      // YouTube
      return `https://www.youtube.com/embed/${streamInfo.videoId}?autoplay=1&enablejsapi=1&rel=0`;
    };

    return jsx("main", {
      className: "live-clipper-container",
      children: jsxs(Fragment, {
        children: [
          // Header Bar
          jsxs("div", {
            className: "live-header-bar",
            children: [
              jsxs("div", {
                children: [
                  jsx("h1", {
                    style: { fontSize: "28px", fontWeight: 800, margin: "0 0 6px 0", letterSpacing: "-0.5px" },
                    children: "Live Stream Clipper"
                  }),
                  jsx("p", {
                    style: { margin: 0, color: "#a1a1aa", fontSize: "14px" },
                    children: "Scrub live DVR streams backward, set In/Out trim markers, and create instant vertical clips."
                  })
                ]
              }),
              jsx("a", {
                className: "btn btn-ghost",
                href: router.home(),
                children: "← Back to Home"
              })
            ]
          }),

          // Input Card
          jsx("div", {
            className: "universal-trim-box",
            style: { marginBottom: "20px" },
            children: jsxs("form", {
              onSubmit: (e) => {
                e.preventDefault();
                fetchStreamInfo();
              },
              style: { display: "flex", gap: "12px", alignItems: "center" },
              children: [
                jsx("input", {
                  className: "input",
                  style: { flex: 1, padding: "10px 14px", fontSize: "15px" },
                  placeholder: "Paste YouTube, Twitch or Kick live stream link (e.g. https://www.youtube.com/watch?v=...)",
                  value: urlInput,
                  onChange: (e) => setUrlInput(e.target.value),
                  disabled: loadingInfo || isSlicing
                }),
                jsx("button", {
                  type: "submit",
                  className: "btn btn-primary",
                  disabled: loadingInfo || !urlInput.trim(),
                  children: loadingInfo ? "Fetching stream..." : "Load Stream"
                })
              ]
            })
          }),

          // Active Stream Section
          streamInfo && jsxs(Fragment, {
            children: [
              // Stream Meta Header
              jsxs("div", {
                style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" },
                children: [
                  jsxs("div", {
                    children: [
                      jsxs("h2", {
                        style: { fontSize: "20px", fontWeight: 700, margin: "0 0 4px 0" },
                        children: [streamInfo.title]
                      }),
                      jsxs("span", {
                        style: { color: "#a1a1aa", fontSize: "13px" },
                        children: [`Channel: ${streamInfo.channel}`, streamInfo.viewCount ? ` • ${streamInfo.viewCount.toLocaleString()} watching` : ""]
                      })
                    ]
                  }),
                  jsxs("span", {
                    className: "live-status-pill",
                    children: [
                      jsx("span", { className: "live-dot" }),
                      streamInfo.isLive ? "LIVE NOW (DVR ENABLED)" : "REPLAY / VOD"
                    ]
                  })
                ]
              }),

              // Kick Player Mode Switcher
              streamInfo.platform === "kick" && jsxs("div", {
                style: { display: "flex", gap: "8px", marginBottom: "12px", alignItems: "center", flexWrap: "wrap" },
                children: [
                  jsx("button", {
                    type: "button",
                    className: `btn btn-small ${!useOfficialEmbed ? "btn-primary" : "btn-ghost"}`,
                    onClick: () => setUseOfficialEmbed(false),
                    children: "📺 Native DVR Player (Scrubbable)"
                  }),
                  jsx("button", {
                    type: "button",
                    className: `btn btn-small ${useOfficialEmbed ? "btn-primary" : "btn-ghost"}`,
                    onClick: () => setUseOfficialEmbed(true),
                    children: "🌐 Kick Web Embed"
                  }),
                  jsx("span", {
                    style: { color: "#a1a1aa", fontSize: "12px", marginLeft: "auto" },
                    children: "⚡ Native DVR Player enables real-time scrubbing backwards and dragging handles to clip."
                  })
                ]
              }),

              // Live Player (Native HLS DVR for Kick, iframe for YouTube/Twitch)
              jsxs("div", {
                className: "live-player-frame",
                children: [
                  (streamInfo.platform === "kick" && streamInfo.hlsStreamUrl && !useOfficialEmbed) ? jsx(HlsVideoPlayer, {
                    key: `kick_dvr_${streamInfo.channel}`,
                    src: streamInfo.hlsStreamUrl,
                    startTime: trim.start,
                    endTime: trim.end,
                    isLive: streamInfo.isLive,
                    title: streamInfo.title
                  }) : jsx("iframe", {
                    ref: playerRef,
                    src: getEmbedPlayerSrc(),
                    title: streamInfo.title,
                    allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen",
                    allowFullScreen: true
                  })
                ]
              }),

              // Universal Trim Slider for Live DVR
              jsx(UniversalTrimSlider, {
                duration: streamInfo.duration || 7200,
                startTime: trim.start,
                endTime: trim.end,
                isLive: true,
                addLabel: isSlicing ? "Processing..." : "⚡ Create Clip Now",
                onTrimChange: (newTrim) => setTrim(newTrim),
                onAddMoment: handleCreateLiveClip,
                extraAction: jsx("button", {
                  type: "button",
                  className: "btn btn-ghost",
                  title: "Find AI highlights in this selected time window",
                  disabled: isSlicing,
                  onClick: handleAnalyzeWindow,
                  children: "🤖 Find AI Highlights"
                })
              }),

              // Slicing Progress Banner
              isSlicing && jsxs("div", {
                style: {
                  padding: "16px 20px",
                  background: "rgba(124, 58, 237, 0.15)",
                  border: "1px solid rgba(168, 85, 247, 0.3)",
                  borderRadius: "10px",
                  marginTop: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px"
                },
                children: [
                  jsx("span", { style: { animation: "spin 1s linear infinite", display: "inline-block" }, children: "⏳" }),
                  jsx("span", { style: { color: "#f3e8ff", fontSize: "14px" }, children: sliceProgress })
                ]
              }),

              // Success Card (When clip is ready)
              lastCreatedClip && jsxs("div", {
                className: "live-success-card",
                children: [
                  jsxs("div", {
                    style: { display: "flex", alignItems: "center", gap: "16px" },
                    children: [
                      jsx("span", { style: { fontSize: "28px" }, children: "🎉" }),
                      jsxs("div", {
                        children: [
                          jsx("h3", { style: { margin: "0 0 4px 0", fontSize: "17px", color: "#4ade80" }, children: "Live clip ready!" }),
                          jsx("p", { style: { margin: 0, fontSize: "13px", color: "#e4e4e7" }, children: "Segment sliced, audio transcribed with Whisper, and saved under 'Your streams'." })
                        ]
                      })
                    ]
                  }),
                  jsx("a", {
                    className: "btn btn-primary",
                    style: { padding: "10px 22px", fontSize: "15px", fontWeight: 700 },
                    href: router.studio(lastCreatedClip.projectId, lastCreatedClip.clipId),
                    children: "Open Clip in Studio →"
                  })
                ]
              }),

              // Session Clips List
              sessionClips.length > 0 && jsxs("div", {
                style: { marginTop: "32px" },
                children: [
                  jsx("h3", { style: { fontSize: "16px", fontWeight: 700, margin: "0 0 12px 0" }, children: `Clips Created This Session (${sessionClips.length})` }),
                  jsx("div", {
                    className: "recent-live-clips-grid",
                    children: sessionClips.map((c, idx) => jsxs("div", {
                      key: c.clipId,
                      className: "recent-live-clip-item",
                      children: [
                        jsxs("div", {
                          style: { flex: 1, minWidth: 0 },
                          children: [
                            jsx("div", { style: { fontWeight: 700, fontSize: "14px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }, children: `Live Clip #${sessionClips.length - idx}` }),
                            jsx("div", { style: { fontSize: "12px", color: "#a1a1aa" }, children: `${Math.round(c.clip?.out - c.clip?.in || 60)}s • Ready` })
                          ]
                        }),
                        jsx("a", {
                          className: "btn btn-small",
                          href: router.studio(c.projectId, c.clipId),
                          children: "Edit Clip"
                        })
                      ]
                    }))
                  })
                ]
              })
            ]
          })
        ]
      })
    });
  }

  return {
    UniversalTrimSlider,
    LiveClipperView,
    MomentPreviewPlayer
  };
}
