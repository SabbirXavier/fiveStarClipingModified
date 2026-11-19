// dist/web/assets/live-trim-ui.js
// Universal Trim Slider, Real-Time Video Sync, Multi-Platform Player, and Live Clipper UI

export function createLiveTrimComponents({ React, jsx, jsxs, Fragment, api, router, toast }) {
  const { useState, useEffect, useRef, useCallback } = React;

  // Pure Lucide SVG Icons for Clips Shelf
  const EditIcon = ({ size = 14 }) => jsx("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
    children: [
      jsx("path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }),
      jsx("path", { d: "m15 5 4 4" })
    ]
  });

  const DownloadIcon = ({ size = 14 }) => jsx("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
    children: [
      jsx("path", { d: "M12 15V3" }),
      jsx("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }),
      jsx("path", { d: "m7 10 5 5 5-5" })
    ]
  });

  const TrashIcon = ({ size = 14 }) => jsx("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
    children: [
      jsx("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }),
      jsx("path", { d: "M3 6h18" }),
      jsx("path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" })
    ]
  });

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
            .btn-live-sync {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(239, 68, 68, 0.16);
        border: 1px solid rgba(239, 68, 68, 0.45);
        color: #fca5a5;
        font-size: 12px;
        font-weight: 700;
        padding: 4px 12px;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .btn-live-sync:hover {
        background: rgba(239, 68, 68, 0.32);
        border-color: #ef4444;
        color: #ffffff;
        transform: translateY(-1px);
      }
      .live-dot-pulse {
        width: 7px;
        height: 7px;
        background: #ef4444;
        border-radius: 50%;
        box-shadow: 0 0 6px #ef4444;
        animation: livePulseAnim 1.4s infinite;
      }
      @keyframes livePulseAnim {
        0% { transform: scale(0.9); opacity: 0.8; }
        50% { transform: scale(1.3); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0.8; }
      }
      .btn-record-live {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(239, 68, 68, 0.2);
        border: 1px solid rgba(239, 68, 68, 0.5);
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        padding: 8px 14px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .btn-record-live:hover {
        background: rgba(239, 68, 68, 0.35);
        border-color: #ef4444;
      }
      .btn-record-live-active {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: #dc2626 !important;
        border: 1px solid #ef4444 !important;
        color: #ffffff !important;
        font-size: 13px !important;
        font-weight: 800 !important;
        padding: 8px 16px !important;
        border-radius: 8px !important;
        cursor: pointer;
        box-shadow: 0 0 16px rgba(239, 68, 68, 0.6);
        animation: recGlow 1.2s infinite alternate;
      }
      @keyframes recGlow {
        from { box-shadow: 0 0 8px rgba(239, 68, 68, 0.4); }
        to { box-shadow: 0 0 20px rgba(239, 68, 68, 0.9); }
      }
      .rec-square {
        width: 10px;
        height: 10px;
        background: #ffffff;
        border-radius: 2px;
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
    bufferBounds = null,
    addLabel = "Add moment",
    applyLabel = "Apply Changes",
    onSyncToLive = null,
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
    const handleSyncLive = () => {
      const currentLen = Math.max(5, Math.min(60, end - start));
      const newEnd = totalDuration;
      const newStart = Math.max(0, newEnd - currentLen);
      updateTrim(newStart, newEnd);
      setPlayhead(newEnd);
      seekActivePlayers(newEnd);
      if (typeof onSyncToLive === "function") {
        onSyncToLive({ start: newStart, end: newEnd });
      }
      toast?.("🔴 Synced to live head (" + formatSec(newEnd) + ")");
    };


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

    const hasBuffer = Boolean(isLive && bufferBounds && Number.isFinite(bufferBounds.bufferStart) && Number.isFinite(bufferBounds.bufferEnd) && bufferBounds.bufferEnd > bufferBounds.bufferStart);
    const bufferLeftPercent = hasBuffer ? Math.max(0, Math.min(100, (bufferBounds.bufferStart / totalDuration) * 100)) : 0;
    const bufferRightPercent = hasBuffer ? Math.max(0, Math.min(100, (bufferBounds.bufferEnd / totalDuration) * 100)) : 0;
    const isSelectionCovered = Boolean(hasBuffer && (start >= bufferBounds.bufferStart - 1.5) && (end <= bufferBounds.bufferEnd + 1.5));

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
                style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" },
                children: [
                  isLive && bufferBounds && jsxs("div", {
                    style: {
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      background: isSelectionCovered ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                      border: `1px solid ${isSelectionCovered ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)"}`,
                      borderRadius: "8px",
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: isSelectionCovered ? "#86efac" : "#fde047"
                    },
                    children: [
                      jsx("span", {
                        style: {
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: isSelectionCovered ? "#10b981" : "#f59e0b",
                          display: "inline-block"
                        }
                      }),
                      jsx("span", {
                        children: hasBuffer
                          ? `Buffer: ${Math.round(bufferBounds.bufferedSeconds)}s (${formatSec(bufferBounds.bufferStart)} - ${formatSec(bufferBounds.bufferEnd)})`
                          : (bufferBounds.status === "starting" ? "Starting Local Buffer..." : "Buffer Ready")
                      }),
                      hasBuffer && !isSelectionCovered && jsx("button", {
                        type: "button",
                        onClick: () => {
                          const dur = Math.min(60, Math.max(5, end - start));
                          const newStart = Math.max(bufferBounds.bufferStart, bufferBounds.bufferEnd - dur);
                          const newEnd = Math.min(bufferBounds.bufferEnd, newStart + dur);
                          updateTrim(newStart, newEnd);
                          seekActivePlayers(newStart);
                          toast?.(`Clamped selection to buffered window [${formatSec(newStart)} - ${formatSec(newEnd)}]`);
                        },
                        style: {
                          background: "#3b82f6",
                          color: "#fff",
                          border: "none",
                          borderRadius: "4px",
                          padding: "1px 6px",
                          fontSize: "10px",
                          fontWeight: 800,
                          cursor: "pointer",
                          marginLeft: "4px"
                        },
                        title: "Clamp trim handles within the locally buffered window",
                        children: "Clamp to Buffer"
                      })
                    ]
                  }),
                  isLive && jsxs("button", {
                    type: "button",
                    className: "btn-live-sync",
                    onClick: handleSyncLive,
                    title: "Jump trim handles directly to the live broadcast head",
                    children: [
                      jsx("span", { className: "live-dot-pulse" }),
                      "Live Sync"
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
              // Local Buffer Range Highlight (when live and buffer active)
              hasBuffer && jsx("div", {
                className: "trim-buffer-highlight",
                style: {
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: `${bufferLeftPercent}%`,
                  width: `${Math.max(0.6, bufferRightPercent - bufferLeftPercent)}%`,
                  background: "rgba(16, 185, 129, 0.22)",
                  borderTop: "2px solid #10b981",
                  borderBottom: "2px solid #10b981",
                  pointerEvents: "none",
                  zIndex: 1,
                  borderRadius: "2px"
                },
                title: `Local Segment Buffer: ${formatSec(bufferBounds.bufferStart)} - ${formatSec(bufferBounds.bufferEnd)} (${Math.round(bufferBounds.bufferedSeconds)}s)`
              }),

              // Highlight band
              jsx("div", {
                className: "trim-range-highlight",
                style: {
                  left: `${leftPercent}%`,
                  width: `${Math.max(1, rightPercent - leftPercent)}%`,
                  zIndex: 2
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
    const [selectedQuality, setSelectedQuality] = useState("best");
    const [selectedLang, setSelectedLang] = useState("hi");
    const [translateToEn, setTranslateToEn] = useState(false);
    const [isLiveSync, setIsLiveSync] = useState(true);
    const [liveHead, setLiveHead] = useState(0);
    const [bufferBounds, setBufferBounds] = useState(() => streamInfo?.bufferStatus || null);
    const bufferPollTimerRef = useRef(null);

    useEffect(() => {
      if (streamInfo?.title) {
        const isIndian = /india|hindi|live stream india|[\u0900-\u097F]/i.test(streamInfo.title);
        if (isIndian) setSelectedLang("hi");
      }
      if (streamInfo?.duration) {
        setLiveHead(streamInfo.duration);
      }
      if (streamInfo?.bufferStatus) {
        setBufferBounds(streamInfo.bufferStatus);
      }
    }, [streamInfo]);

    // Synchronize Rolling Segment Buffer & Poll available [bufferStart, bufferEnd] bounds
    useEffect(() => {
      if (!streamInfo?.url || !streamInfo?.isLive) return;

      const pollBuffer = async () => {
        try {
          const res = await fetch(`/api/live/buffer/status?url=${encodeURIComponent(streamInfo.url)}&from=${trim.start}&to=${trim.end}`);
          if (res.ok) {
            const data = await res.json();
            if (data.ok) {
              setBufferBounds(data);
            }
          }
        } catch {}
      };

      pollBuffer();
      bufferPollTimerRef.current = setInterval(pollBuffer, 2500);

      return () => {
        if (bufferPollTimerRef.current) clearInterval(bufferPollTimerRef.current);
      };
    }, [streamInfo?.url, streamInfo?.isLive, trim.start, trim.end]);

    // Clean up background buffer service when user switches stream URL or component unmounts
    useEffect(() => {
      const activeUrl = streamInfo?.url;
      return () => {
        if (activeUrl) {
          fetch("/api/live/buffer/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: activeUrl }),
            keepalive: true
          }).catch(() => {});
        }
      };
    }, [streamInfo?.url]);

    // Live Edge Real-Time Ticker: continuously tracks broadcast progress
    useEffect(() => {
      if (!streamInfo?.isLive) return;
      const interval = setInterval(() => {
        setLiveHead(prev => {
          const nextHead = (prev || streamInfo?.duration || 7200) + 1;
          if (isLiveSync) {
            setTrim(t => {
              const dur = Math.max(5, Math.min(180, t.duration || (t.end - t.start) || 60));
              return {
                start: Math.max(0, nextHead - dur),
                end: nextHead,
                duration: dur
              };
            });
          }
          return nextHead;
        });
      }, 1000);
      return () => clearInterval(interval);
    }, [streamInfo?.isLive, isLiveSync]);
    const [isSlicing, setIsSlicing] = useState(false);
    const [sliceProgress, setSliceProgress] = useState("");
    const [lastCreatedClip, setLastCreatedClip] = useState(null);
    const [currentProjectId, setCurrentProjectId] = useState(null);
    const [clips, setClips] = useState([]);
    const [useOfficialEmbed, setUseOfficialEmbed] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [recordSec, setRecordSec] = useState(0);
    const [recordStart, setRecordStart] = useState(0);
    const recordTimerRef = useRef(null);

    const playerRef = useRef(null);

    useEffect(() => {
      return () => {
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      };
    }, []);

    const handleSyncLiveHead = async () => {
      if (!streamInfo?.url) return;
      try {
        const res = await fetch("/api/live/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: streamInfo.url })
        });
        const latest = await res.json();
        if (latest.ok && latest.duration) {
          setStreamInfo(prev => ({ ...prev, duration: latest.duration }));
          const newEnd = latest.duration;
          const currentDuration = Math.min(60, Math.max(5, trim.end - trim.start));
          const newStart = Math.max(0, newEnd - currentDuration);
          setTrim({ start: newStart, end: newEnd, duration: currentDuration });
        }
      } catch (e) {
        console.warn("Could not refresh live head:", e.message);
      }
    };

    const handleStartRecording = () => {
      if (!streamInfo) return;
      const currentHead = streamInfo.duration || 7200;
      setRecordStart(currentHead);
      setRecordSec(0);
      setIsRecording(true);
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = setInterval(() => {
        setRecordSec(s => s + 1);
      }, 1000);
      toast?.("🔴 Live recording started! Click 'Stop & Clip' when the moment ends.");
    };

    const handleStopRecording = async () => {
      clearInterval(recordTimerRef.current);
      setIsRecording(false);
      const dur = Math.max(3, recordSec);
      if (dur < 3) {
        return toast?.("Recording must be at least 3 seconds.", true);
      }
      const end = (streamInfo.duration || recordStart) + dur;
      const start = Math.max(0, end - dur);

      setIsSlicing(true);
      setSliceProgress("Saving " + dur + "s live recording with FFmpeg & transcribing...");
      try {
        const res = await fetch("/api/live/slice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: streamInfo.url,
            masterM3u8: streamInfo.masterM3u8,
            start,
            end,
            streamDuration: (streamInfo.duration || recordStart) + dur,
            rewoundSec: Math.max(0, dur),
            title: streamInfo.title,
            channel: streamInfo.channel,
            videoId: streamInfo.videoId,
            thumbnail: streamInfo.thumbnail,
            quality: selectedQuality,
            language: selectedLang,
            translate: translateToEn
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to slice recorded segment.");
        setLastCreatedClip(data);
        if (data.projectId) setCurrentProjectId(data.projectId);
        if (Array.isArray(data.clips)) {
          setClips(data.clips);
        } else if (data.clip) {
          setClips(prev => [data.clip, ...prev.filter(c => c.id !== data.clip.id)]);
        }
        toast?.("🎉 Captured " + dur + "s recording! Clip is ready.");
      } catch (err) {
        toast?.(err.message, true);
      } finally {
        setIsSlicing(false);
        setSliceProgress("");
      }
    };

    const handleCancelRecording = () => {
      clearInterval(recordTimerRef.current);
      setIsRecording(false);
      setRecordSec(0);
      toast?.("Live recording cancelled.");
    };

    // Auto-load if initial URL provided in query or from last session
    useEffect(() => {
      const hash = window.location.hash || "";
      const queryIdx = hash.indexOf("?");
      let passedUrl = "";
      if (queryIdx !== -1) {
        const params = new URLSearchParams(hash.substring(queryIdx + 1));
        passedUrl = params.get("url") || "";
      }
      if (!passedUrl) {
        try {
          passedUrl = localStorage.getItem("fivestar_last_live_url") || "";
        } catch {}
      }
      if (passedUrl) {
        setUrlInput(passedUrl);
        fetchStreamInfo(passedUrl);
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
        if (data.projectId) setCurrentProjectId(data.projectId);
        if (Array.isArray(data.clips)) setClips(data.clips);
        try { localStorage.setItem("fivestar_last_live_url", u); } catch {}

        if (data.bufferStatus) setBufferBounds(data.bufferStatus);
        const platform = (data.platform || "youtube").toLowerCase();
        const dur = data.duration || 7200;
        setLiveHead(dur);
        setIsLiveSync(true);
        const initialStart = Math.max(0, dur - 60);
        const initialEnd = dur;
        const initialDuration = 60;
        setTrim({ start: initialStart, end: initialEnd, duration: initialDuration });
        toast?.(`Loaded stream: ${data.title}`);
      } catch (err) {
        toast?.(err.message, true);
      } finally {
        setLoadingInfo(false);
        setSliceProgress("");
      }
    };

    // Live background polling when clips are being transcribed or exported
    useEffect(() => {
      if (!currentProjectId) return;
      const isPending = clips.some(c => c.status === "transcribing" || c.status === "downloading" || c.status === "rendering" || c.status === "queued");
      if (!isPending) return;

      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/projects/${currentProjectId}`);
          if (res.ok) {
            const p = await res.json();
            if (Array.isArray(p?.clips)) {
              setClips(p.clips);
            }
          }
        } catch {}
      }, 3000);

      return () => clearInterval(interval);
    }, [currentProjectId, clips]);

    // Delete a clip from the project & update view
    const handleDeleteClip = async (clipId) => {
      if (!currentProjectId || !clipId) return;
      if (!window.confirm("Remove this clip? Its video files are deleted from this computer.")) return;
      try {
        const res = await fetch(`/api/projects/${currentProjectId}/clips/${clipId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete clip");
        setClips(prev => prev.filter(c => c.id !== clipId));
        if (lastCreatedClip?.clipId === clipId) setLastCreatedClip(null);
        toast?.("Clip removed.");
      } catch (err) {
        toast?.(err.message || "Failed to remove clip", true);
      }
    };

    // Stage 2: Instant Slice & Transcribe Mode
    const handleCreateLiveClip = async () => {
      if (!streamInfo) return;
      const dur = Math.max(3, Math.min(180, trim.duration || (trim.end - trim.start) || 60));

      setIsSlicing(true);
      const isLocallyBuffered = bufferBounds && (trim.start >= bufferBounds.bufferStart - 1.5) && (trim.end <= bufferBounds.bufferEnd + 1.5);
      setSliceProgress(isLocallyBuffered
        ? "Extracting frame-accurate clip from local segment buffer (re-encoding x264+aac)..."
        : "Fetching historical DVR sequence via YouTube DASH engine & transcribing with Whisper..."
      );
      try {
        const currentHead = liveHead || streamInfo.duration || 7200;
        const rewoundSec = isLiveSync ? 0 : Math.max(0, currentHead - trim.start);
        const res = await fetch("/api/live/slice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: currentProjectId,
            url: streamInfo.url,
            masterM3u8: streamInfo.masterM3u8,
            sessionId: bufferBounds?.sessionId,
            isLiveHead: isLiveSync,
            fromLive: isLiveSync ? dur : undefined,
            start: trim.start,
            end: trim.end,
            streamDuration: currentHead,
            rewoundSec,
            title: streamInfo.title,
            channel: streamInfo.channel,
            videoId: streamInfo.videoId,
            thumbnail: streamInfo.thumbnail,
            quality: selectedQuality,
            language: selectedLang,
            translate: translateToEn
          })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to slice live stream.");

        setLastCreatedClip(data);
        if (data.projectId) setCurrentProjectId(data.projectId);
        if (Array.isArray(data.clips)) {
          setClips(data.clips);
        } else if (data.clip) {
          setClips(prev => [data.clip, ...prev.filter(c => c.id !== data.clip.id)]);
        }
        toast?.("Live clip created successfully! Ready to edit.");
      } catch (err) {
        toast?.(err.message, true);
      } finally {
        setIsSlicing(false);
        setSliceProgress("");
      }
    };

    const handleQuickClip = async (sec) => {
      if (!streamInfo) return;
      setIsSlicing(true);
      setSliceProgress(`Extracting last ${sec}s from live stream & transcribing with Whisper...`);
      try {
        const currentHead = liveHead || streamInfo.duration || 7200;
        const res = await fetch("/api/live/slice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: currentProjectId,
            url: streamInfo.url,
            masterM3u8: streamInfo.masterM3u8,
            sessionId: bufferBounds?.sessionId,
            isLiveHead: true,
            fromLive: sec,
            start: Math.max(0, currentHead - sec),
            end: currentHead,
            streamDuration: currentHead,
            rewoundSec: sec,
            title: streamInfo.title,
            channel: streamInfo.channel,
            videoId: streamInfo.videoId,
            thumbnail: streamInfo.thumbnail,
            quality: selectedQuality,
            language: selectedLang,
            translate: translateToEn
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to slice live stream.");
        setLastCreatedClip(data);
        if (data.projectId) setCurrentProjectId(data.projectId);
        if (Array.isArray(data.clips)) {
          setClips(data.clips);
        } else if (data.clip) {
          setClips(prev => [data.clip, ...prev.filter(c => c.id !== data.clip.id)]);
        }
        toast?.(`🎉 Captured last ${sec}s of live stream!`);
      } catch (err) {
        toast?.(err.message, true);
      } finally {
        setIsSlicing(false);
        setSliceProgress("");
      }
    };

    const handleSnapToLive = () => {
      setIsLiveSync(true);
      const head = liveHead || streamInfo?.duration || 7200;
      const dur = Math.max(5, Math.min(180, trim.duration || 60));
      setTrim({ start: Math.max(0, head - dur), end: head, duration: dur });
      toast?.("🔴 Snapped back to live edge!");
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
                duration: liveHead || streamInfo.duration || 7200,
                startTime: trim.start,
                endTime: trim.end,
                isLive: true,
                bufferBounds,
                addLabel: isSlicing ? "Processing..." : (isLiveSync ? "⚡ Create Clip Now (Live)" : "⚡ Create Clip from Selection"),
                onTrimChange: (newTrim) => {
                  setTrim(newTrim);
                  const head = liveHead || streamInfo.duration || 7200;
                  if (head - newTrim.end > 4) {
                    setIsLiveSync(false);
                  }
                },
                onAddMoment: handleCreateLiveClip,
                onSyncToLive: handleSnapToLive,
                extraAction: jsxs("div", {
                  style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
                  children: [
                    // Live Sync Status Badge
                    jsxs("div", {
                      style: {
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: isLiveSync ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                        border: `1px solid ${isLiveSync ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)"}`,
                        borderRadius: "8px",
                        padding: "3px 10px",
                        color: isLiveSync ? "#86efac" : "#fde047",
                        fontSize: "12px",
                        fontWeight: 700
                      },
                      children: [
                        jsx("span", {
                          children: isLiveSync ? "🟢 LIVE SYNC (Active)" : `⏸️ REWOUND (-${Math.round(Math.max(0, (liveHead || 7200) - trim.end))}s)`
                        }),
                        !isLiveSync && jsx("button", {
                          type: "button",
                          onClick: handleSnapToLive,
                          style: {
                            background: "#ef4444",
                            color: "#fff",
                            border: "none",
                            borderRadius: "4px",
                            padding: "1px 6px",
                            fontSize: "10.5px",
                            fontWeight: 800,
                            cursor: "pointer"
                          },
                          title: "Jump back to current live edge",
                          children: "Snap to Live"
                        })
                      ]
                    }),
                    // Quick Clip Pills: 30s, 60s, 90s, 120s
                    jsxs("div", {
                      style: {
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        background: "rgba(24, 17, 38, 0.95)",
                        border: "1px solid #4a3869",
                        borderRadius: "8px",
                        padding: "3px 8px"
                      },
                      children: [
                        jsx("span", {
                          style: { fontSize: "12px", color: "#a1a1aa", fontWeight: 600, marginRight: "2px" },
                          children: "⚡ Quick Clip:"
                        }),
                        [30, 60, 90, 120].map(s => jsx("button", {
                          key: `quick_${s}`,
                          type: "button",
                          style: {
                            padding: "2px 7px",
                            fontSize: "11.5px",
                            fontWeight: 700,
                            borderRadius: "5px",
                            border: "1px solid #635086",
                            background: s === 60 ? "rgba(255, 209, 102, 0.2)" : "rgba(255,255,255,0.06)",
                            color: s === 60 ? "#ffd166" : "#e2e8f0",
                            cursor: "pointer"
                          },
                          onClick: () => handleQuickClip(s),
                          title: `Instantly clip the last ${s} seconds from live broadcast`,
                          children: `${s}s`
                        }))
                      ]
                    }),
                    jsxs("div", {
                      style: {
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: "rgba(24, 17, 38, 0.95)",
                        border: "1px solid #4a3869",
                        borderRadius: "8px",
                        padding: "3px 8px",
                        color: "#e2e8f0"
                      },
                      children: [
                        jsx("span", {
                          style: { fontSize: "12px", color: "#a1a1aa", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 },
                          children: ["🎚️ Quality:"]
                        }),
                        jsx("select", {
                          value: selectedQuality,
                          onChange: (e) => setSelectedQuality(e.target.value),
                          style: {
                            background: "transparent",
                            border: "none",
                            color: "#ffd166",
                            fontWeight: 700,
                            fontSize: "12.5px",
                            cursor: "pointer",
                            outline: "none",
                            paddingRight: "4px"
                          },
                          title: "Select video resolution before clipping",
                          children: (streamInfo?.qualities && streamInfo.qualities.length ? streamInfo.qualities : [
                            { id: "best", label: "✨ Best Available (Highest Quality)" },
                            { id: "1440", label: "1440p60 HD" },
                            { id: "1080", label: "1080p60 HD" },
                            { id: "720", label: "720p60" },
                            { id: "480", label: "480p" },
                            { id: "360", label: "360p" }
                          ]).map(q => jsx("option", {
                            key: q.id,
                            value: q.id,
                            style: { background: "#1c142d", color: "#f3effa" },
                            children: q.label
                          }))
                        })
                      ]
                    }),
                    jsxs("div", {
                      style: {
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: "rgba(24, 17, 38, 0.95)",
                        border: "1px solid #4a3869",
                        borderRadius: "8px",
                        padding: "3px 8px",
                        color: "#e2e8f0"
                      },
                      children: [
                        jsx("span", {
                          style: { fontSize: "12px", color: "#a1a1aa", fontWeight: 600, display: "flex", alignItems: "center", gap: 3 },
                          children: ["🗣️ Captions:"]
                        }),
                        jsx("select", {
                          value: selectedLang,
                          onChange: (e) => setSelectedLang(e.target.value),
                          style: {
                            background: "transparent",
                            border: "none",
                            color: "#38e8ff",
                            fontWeight: 700,
                            fontSize: "12.5px",
                            cursor: "pointer",
                            outline: "none",
                            paddingRight: "4px"
                          },
                          title: "Select spoken language for AI captions",
                          children: [
                            { id: "hi", label: "Hindi (हिंदी)" },
                            { id: "en", label: "English" },
                            { id: "ur", label: "Urdu (اردو)" },
                            { id: "bn", label: "Bengali" },
                            { id: "ta", label: "Tamil" },
                            { id: "te", label: "Telugu" },
                            { id: "mr", label: "Marathi" },
                            { id: "pa", label: "Punjabi" },
                            { id: "es", label: "Spanish" },
                            { id: "pt", label: "Portuguese" },
                            { id: "fr", label: "French" }
                          ].map(q => jsx("option", {
                            key: q.id,
                            value: q.id,
                            style: { background: "#1c142d", color: "#f3effa" },
                            children: q.label
                          }))
                        }),
                        jsxs("label", {
                          style: {
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            cursor: "pointer",
                            fontSize: "11px",
                            color: translateToEn ? "#86efac" : "#a1a1aa",
                            marginLeft: 4
                          },
                          title: "Translate spoken language to English captions",
                          children: [
                            jsx("input", {
                              type: "checkbox",
                              checked: translateToEn,
                              onChange: (e) => setTranslateToEn(e.target.checked),
                              style: { cursor: "pointer", accentColor: "#86efac" }
                            }),
                            "To English"
                          ]
                        })
                      ]
                    }),
                    !isRecording ? jsxs("button", {
                      type: "button",
                      className: "btn btn-record-live",
                      title: "Start recording live broadcast in real time",
                      disabled: isSlicing,
                      onClick: handleStartRecording,
                      children: [
                        jsx("span", { className: "live-dot-pulse" }),
                        "Record Live"
                      ]
                    }) : jsxs(Fragment, {
                      children: [
                        jsxs("button", {
                          type: "button",
                          className: "btn btn-record-live-active",
                          title: "Stop recording and create clip",
                          onClick: handleStopRecording,
                          children: [
                            jsx("span", { className: "rec-square" }),
                            "Stop & Clip (" + formatSec(recordSec) + ")"
                          ]
                        }),
                        jsx("button", {
                          type: "button",
                          className: "btn btn-ghost",
                          style: { color: "#f87171" },
                          onClick: handleCancelRecording,
                          children: "Cancel"
                        })
                      ]
                    }),
                    jsx("button", {
                      type: "button",
                      className: "btn btn-ghost",
                      title: "Find AI highlights in this selected time window",
                      disabled: isSlicing || isRecording,
                      onClick: handleAnalyzeWindow,
                      children: "🤖 Find AI Highlights"
                    })
                  ]
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

              // Clips Shelf (Matches VOD Project Interface in Image 3)
              clips.length > 0 && jsxs("section", {
                className: "clips-shelf",
                style: { marginTop: "36px" },
                children: [
                  jsxs("div", {
                    style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" },
                    children: [
                      jsx("h2", {
                        className: "section-title",
                        style: { margin: 0, fontSize: "20px", fontWeight: 700 },
                        children: `Clips (${clips.length})`
                      }),
                      currentProjectId && jsx("a", {
                        className: "btn btn-small btn-ghost",
                        href: router.stream(currentProjectId),
                        style: { fontSize: "13px", color: "var(--text-dim, #a1a1aa)" },
                        children: "Open in Stream View →"
                      })
                    ]
                  }),
                  jsx("div", {
                    className: "clip-grid",
                    children: clips.map((clip, index) => {
                      const isReady = clip.status === "ready" || clip.status === "done" || clip.status === "rendering";
                      const isExported = !!clip.output || clip.status === "done";
                      const isTranscribing = clip.status === "transcribing";
                      const isRendering = clip.status === "rendering";
                      const isError = clip.status === "error";

                      let badgeLabel = "Ready to edit";
                      if (isExported) badgeLabel = "Exported";
                      else if (isRendering) badgeLabel = `Exporting ${Math.round((clip.progress || 0) * 100)}%`;
                      else if (isTranscribing) badgeLabel = "Writing captions…";
                      else if (isError) badgeLabel = "Error";
                      else if (clip.status === "queued") badgeLabel = "Queued";

                      const posterSrc = clip.output?.thumb
                        ? `/files/projects/${currentProjectId}/${clip.output.thumb}`
                        : clip.poster
                          ? `/files/projects/${currentProjectId}/${clip.poster}`
                          : streamInfo?.thumbnail || "";

                      const clipTitle = clip.meta?.title || clip.cover?.text || `Live Clip ${clips.length - index}`;

                      const cardThumbnail = jsxs(Fragment, {
                        children: [
                          posterSrc
                            ? jsx("img", { src: posterSrc, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } })
                            : jsx("div", { style: { width: "100%", height: "100%", background: "#18181b", display: "flex", alignItems: "center", justifyContent: "center" }, children: "🎬" }),
                          jsxs("span", {
                            className: "clip-shot-state",
                            children: [
                              jsx("span", { children: badgeLabel }),
                              (isRendering || isTranscribing) && jsx("span", {
                                className: "bar",
                                children: jsx("i", { style: { width: `${Math.round((clip.progress || 0.5) * 100)}%` } })
                              })
                            ]
                          })
                        ]
                      });

                      return jsxs("div", {
                        key: clip.id,
                        className: "clip-card",
                        children: [
                          isReady
                            ? jsx("a", {
                                className: "clip-shot",
                                href: router.studio(currentProjectId, clip.id),
                                "aria-label": `Open clip ${index + 1} in editor`,
                                children: cardThumbnail
                              })
                            : jsx("div", { className: "clip-shot", children: cardThumbnail }),
                          jsx("div", {
                            className: "clip-title",
                            style: {
                              fontSize: "13px",
                              fontWeight: 600,
                              lineHeight: "1.3",
                              maxHeight: "2.6em",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical"
                            },
                            children: clipTitle
                          }),
                          jsxs("div", {
                            className: "row",
                            style: { gap: 6, marginTop: 4 },
                            children: [
                              isReady && jsxs("a", {
                                className: "btn btn-small",
                                href: router.studio(currentProjectId, clip.id),
                                style: { flex: 1, justifyContent: "center", gap: 6 },
                                children: [
                                  jsx(EditIcon, { size: 14 }),
                                  "Edit"
                                ]
                              }),
                              isExported && jsx("a", {
                                className: "btn btn-small btn-icon",
                                href: `/api/projects/${currentProjectId}/clips/${clip.id}/download`,
                                title: "Download exported MP4",
                                "aria-label": "Download the MP4",
                                children: jsx(DownloadIcon, { size: 14 })
                              }),
                              !isExported && clip.src?.file && jsx("a", {
                                className: "btn btn-small btn-icon",
                                href: `/files/projects/${currentProjectId}/${clip.src.file}`,
                                download: `${clipTitle.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}.mp4`,
                                title: "Download source clip MP4",
                                "aria-label": "Download source clip",
                                children: jsx(DownloadIcon, { size: 14 })
                              }),
                              jsx("button", {
                                className: "btn btn-small btn-icon btn-ghost btn-danger",
                                onClick: () => handleDeleteClip(clip.id),
                                title: "Remove this clip",
                                "aria-label": "Remove this clip",
                                children: jsx(TrashIcon, { size: 14 })
                              })
                            ]
                          })
                        ]
                      });
                    })
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
