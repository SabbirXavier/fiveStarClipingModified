// dist/web/assets/storage-ui.js
// Dedicated Storage Cleanup Dashboard UI for Fivestar

export function createStorageComponents({ React, jsx, jsxs, Fragment, router, toast }) {
  const { useState, useEffect, useMemo, useCallback } = React;

  // Format bytes to readable string (e.g. 145.2 MB, 1.4 GB)
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb.toFixed(1)} MB`;
  }

  function formatDate(ts) {
    if (!ts) return "Recently";
    try {
      const d = new Date(ts);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "Recently";
    }
  }

  // Pure SVG Icons
  const StorageIcon = ({ size = 20, className = "" }) => jsx("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className,
    children: [
      jsx("line", { x1: "22", y1: "12", x2: "2", y2: "12" }),
      jsx("path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }),
      jsx("line", { x1: "6", y1: "16", x2: "6.01", y2: "16" }),
      jsx("line", { x1: "10", y1: "16", x2: "10.01", y2: "16" })
    ]
  });

  const BroomIcon = ({ size = 16, className = "" }) => jsx("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className,
    children: [
      jsx("path", { d: "m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" }),
      jsx("path", { d: "m5 2 5 5" }),
      jsx("path", { d: "M2 5l5 5" }),
      jsx("path", { d: "m22 22-5-5" })
    ]
  });

  const TrashIcon = ({ size = 16, className = "" }) => jsx("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className,
    children: [
      jsx("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }),
      jsx("path", { d: "M3 6h18" }),
      jsx("path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" })
    ]
  });

  const RefreshIcon = ({ size = 16, className = "" }) => jsx("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className,
    children: [
      jsx("path", { d: "M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }),
      jsx("path", { d: "M3 3v5h5" }),
      jsx("path", { d: "M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" }),
      jsx("path", { d: "M16 16h5v5" })
    ]
  });

  const ChevronIcon = ({ open = false, size = 16 }) => jsx("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
    style: { transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" },
    children: [
      jsx("polyline", { points: "6 9 12 15 18 9" })
    ]
  });

  const EditIcon = ({ size = 14 }) => jsx("svg", {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
    children: [
      jsx("path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }),
      jsx("path", { d: "m15 5 4 4" })
    ]
  });

  function StorageDashboardView() {
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterTab, setFilterTab] = useState("all"); // 'all', 'exports', 'live', 'largest'
    const [expandedProjects, setExpandedProjects] = useState(new Set());
    const [selectedProjectIds, setSelectedProjectIds] = useState(new Set());

    const fetchSummary = useCallback(async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/storage/summary");
        if (!res.ok) throw new Error("Failed to load storage summary");
        const data = await res.json();
        setSummary(data);
      } catch (err) {
        toast?.(err.message || "Failed to load storage summary", true);
      } finally {
        setLoading(false);
      }
    }, [toast]);

    useEffect(() => {
      fetchSummary();
    }, [fetchSummary]);

    // Clean temporary buffers & partials
    const handleCleanTemp = async () => {
      try {
        setActionLoading(true);
        const res = await fetch("/api/storage/clean-temp", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to clean temporary files");
        toast?.(data.message || `Cleaned temporary files.`);
        await fetchSummary();
      } catch (err) {
        toast?.(err.message || "Cleanup failed", true);
      } finally {
        setActionLoading(false);
      }
    };

    // Clean all exports across all projects
    const handleCleanAllExports = async () => {
      const exportBytes = summary?.fivestar?.categories?.exports?.bytes || 0;
      const formatted = formatBytes(exportBytes);
      const ok = window.confirm(`Permanently remove all finished MP4 exports to reclaim ${formatted}?\n\nNOTE: All your clips, subtitles, captions, and project data will remain 100% safe and intact so you can re-export anytime.`);
      if (!ok) return;

      try {
        setActionLoading(true);
        const res = await fetch("/api/storage/clean-exports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to clean exports");
        toast?.(data.message || `Cleaned exports.`);
        await fetchSummary();
      } catch (err) {
        toast?.(err.message || "Failed to clear exports", true);
      } finally {
        setActionLoading(false);
      }
    };

    // Clean exports for a single project
    const handleCleanProjectExports = async (projectId) => {
      try {
        setActionLoading(true);
        const res = await fetch("/api/storage/clean-exports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to clean project exports");
        toast?.(data.message || "Cleaned project exports.");
        await fetchSummary();
      } catch (err) {
        toast?.(err.message || "Failed to clean project exports", true);
      } finally {
        setActionLoading(false);
      }
    };

    // Delete single project permanently
    const handleDeleteProject = async (projectId, title) => {
      const ok = window.confirm(`Permanently delete "${title || projectId}" and all its clips?\n\nThis cannot be undone.`);
      if (!ok) return;

      try {
        setActionLoading(true);
        const res = await fetch(`/api/storage/project/${projectId}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to delete project");
        toast?.(data.message || "Project deleted.");
        setSelectedProjectIds(prev => {
          const next = new Set(prev);
          next.delete(projectId);
          return next;
        });
        await fetchSummary();
      } catch (err) {
        toast?.(err.message || "Failed to delete project", true);
      } finally {
        setActionLoading(false);
      }
    };

    // Delete single clip permanently
    const handleDeleteClip = async (projectId, clipId, clipTitle) => {
      const ok = window.confirm(`Permanently delete clip "${clipTitle || clipId}"?\n\nVideo files and subtitles will be removed.`);
      if (!ok) return;

      try {
        setActionLoading(true);
        const res = await fetch(`/api/storage/project/${projectId}/clip/${clipId}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to delete clip");
        toast?.(data.message || "Clip deleted.");
        await fetchSummary();
      } catch (err) {
        toast?.(err.message || "Failed to delete clip", true);
      } finally {
        setActionLoading(false);
      }
    };

    // Delete export only for single clip
    const handleDeleteClipExport = async (projectId, clipId) => {
      try {
        setActionLoading(true);
        const res = await fetch("/api/storage/clean-exports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, clipId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to delete clip export");
        toast?.("Exported MP4 removed. Clip and captions remain ready in editor.");
        await fetchSummary();
      } catch (err) {
        toast?.(err.message || "Failed to remove export", true);
      } finally {
        setActionLoading(false);
      }
    };

    // Bulk delete selected projects
    const handleBulkDelete = async () => {
      const ids = Array.from(selectedProjectIds);
      if (!ids.length) return;
      const ok = window.confirm(`Permanently delete ${ids.length} selected projects and ALL their media?\n\nThis cannot be undone.`);
      if (!ok) return;

      try {
        setActionLoading(true);
        const res = await fetch("/api/storage/bulk-delete-projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectIds: ids })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to delete projects");
        toast?.(data.message || `Deleted ${ids.length} projects.`);
        setSelectedProjectIds(new Set());
        await fetchSummary();
      } catch (err) {
        toast?.(err.message || "Failed to delete projects", true);
      } finally {
        setActionLoading(false);
      }
    };

    const toggleExpand = (projectId) => {
      setExpandedProjects(prev => {
        const next = new Set(prev);
        if (next.has(projectId)) next.delete(projectId);
        else next.add(projectId);
        return next;
      });
    };

    const toggleSelect = (projectId) => {
      setSelectedProjectIds(prev => {
        const next = new Set(prev);
        if (next.has(projectId)) next.delete(projectId);
        else next.add(projectId);
        return next;
      });
    };

    const handleSelectAll = (filteredProjects) => {
      if (selectedProjectIds.size === filteredProjects.length && filteredProjects.length > 0) {
        setSelectedProjectIds(new Set());
      } else {
        setSelectedProjectIds(new Set(filteredProjects.map(p => p.id)));
      }
    };

    // Filtered & searched projects
    const filteredProjects = useMemo(() => {
      if (!summary?.projects) return [];
      let list = [...summary.projects];

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        list = list.filter(p => (p.title || "").toLowerCase().includes(q) || (p.channel || "").toLowerCase().includes(q));
      }

      if (filterTab === "exports") {
        list = list.filter(p => p.exportsBytes > 0);
      } else if (filterTab === "live") {
        list = list.filter(p => p.isLive);
      } else if (filterTab === "largest") {
        list.sort((a, b) => b.totalBytes - a.totalBytes);
      }

      return list;
    }, [summary?.projects, searchQuery, filterTab]);

    const totalFivestarBytes = summary?.fivestar?.totalBytes || 0;
    const reclaimableBytes = summary?.fivestar?.reclaimableBytes || 0;
    const diskFreeBytes = summary?.disk?.freeBytes || 0;
    const diskTotalBytes = summary?.disk?.totalBytes || 0;
    const diskUsedBytes = summary?.disk?.usedBytes || 0;
    const freePercent = diskTotalBytes > 0 ? Math.round((diskFreeBytes / diskTotalBytes) * 100) : 0;

    const cats = summary?.fivestar?.categories || {};
    const exportsBytes = cats.exports?.bytes || 0;
    const sourceClipsBytes = cats.sourceClips?.bytes || 0;
    const rawBytes = cats.rawDownloads?.bytes || 0;
    const liveBuffersBytes = cats.liveBuffers?.bytes || 0;
    const tempBytes = cats.tempFiles?.bytes || 0;
    const aiModelsBytes = cats.aiModels?.bytes || 0;

    // Segment widths for visual bar
    const pExports = totalFivestarBytes > 0 ? (exportsBytes / totalFivestarBytes) * 100 : 0;
    const pSource = totalFivestarBytes > 0 ? (sourceClipsBytes / totalFivestarBytes) * 100 : 0;
    const pRaw = totalFivestarBytes > 0 ? (rawBytes / totalFivestarBytes) * 100 : 0;
    const pTemp = totalFivestarBytes > 0 ? ((liveBuffersBytes + tempBytes) / totalFivestarBytes) * 100 : 0;
    const pModels = totalFivestarBytes > 0 ? (aiModelsBytes / totalFivestarBytes) * 100 : 0;

    return jsxs("main", {
      className: "page storage-page",
      style: { maxWidth: 1180, margin: "0 auto", padding: "28px 20px 80px 20px" },
      children: [
        // Top Header
        jsxs("div", {
          style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 28 },
          children: [
            jsxs("div", {
              children: [
                jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: 12 },
                  children: [
                    jsx("div", {
                      style: {
                        width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                        display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 4px 14px rgba(168, 85, 247, 0.35)"
                      },
                      children: jsx(StorageIcon, { size: 22 })
                    }),
                    jsx("h1", { style: { margin: 0, fontSize: "28px", fontWeight: 800, color: "var(--ink, #fff3e4)" }, children: "Storage & Cleanup" })
                  ]
                }),
                jsx("p", {
                  style: { margin: "8px 0 0 0", fontSize: "14px", color: "var(--ink-3, #9a8bb8)", maxWidth: 640 },
                  children: "Monitor disk space consumed by video cuts, finished shorts, and live DVR streams. Permanently clean up files to save disk storage."
                })
              ]
            }),
            jsxs("div", {
              style: { display: "flex", alignItems: "center", gap: 10 },
              children: [
                jsx("button", {
                  className: "btn btn-small btn-ghost",
                  onClick: fetchSummary,
                  disabled: loading || actionLoading,
                  title: "Refresh storage metrics",
                  children: jsxs("span", {
                    style: { display: "flex", alignItems: "center", gap: 6 },
                    children: [
                      jsx(RefreshIcon, { size: 14, className: loading ? "spin-animation" : "" }),
                      "Refresh"
                    ]
                  })
                }),
                jsx("a", {
                  className: "btn btn-small",
                  href: router.home(),
                  children: "← Back to Home"
                })
              ]
            })
          ]
        }),

        // 3 Key Metric Cards
        jsxs("div", {
          style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18, marginBottom: 24 },
          children: [
            // Card 1: Total Fivestar Storage
            jsxs("div", {
              style: {
                background: "var(--surface, #1c1034)", border: "1px solid var(--line, #32204f)", borderRadius: 16,
                padding: "20px 22px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden"
              },
              children: [
                jsx("span", { style: { fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3, #9a8bb8)", fontWeight: 700 }, children: "Fivestar Data Usage" }),
                jsx("div", { style: { fontSize: "32px", fontWeight: 900, color: "#c084fc", margin: "6px 0 4px 0", letterSpacing: "-0.02em" }, children: formatBytes(totalFivestarBytes) }),
                jsx("span", { style: { fontSize: "13px", color: "var(--ink-2, #cdbfe0)" }, children: `${summary?.projects?.length || 0} streams & ${cats.sourceClips?.count || 0} clips saved` })
              ]
            }),

            // Card 2: Reclaimable Space
            jsxs("div", {
              style: {
                background: "var(--surface, #1c1034)", border: "1px solid rgba(238, 63, 140, 0.35)", borderRadius: 16,
                padding: "20px 22px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden"
              },
              children: [
                jsx("span", { style: { fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#f472b6", fontWeight: 700 }, children: "Safe Reclaimable Space" }),
                jsx("div", { style: { fontSize: "32px", fontWeight: 900, color: "#f472b6", margin: "6px 0 4px 0", letterSpacing: "-0.02em" }, children: formatBytes(reclaimableBytes) }),
                jsx("span", { style: { fontSize: "13px", color: "var(--ink-2, #cdbfe0)" }, children: `${formatBytes(exportsBytes)} in exports + ${formatBytes(liveBuffersBytes + tempBytes)} temp` })
              ]
            }),

            // Card 3: Free Drive Capacity
            jsxs("div", {
              style: {
                background: "var(--surface, #1c1034)", border: "1px solid var(--line, #32204f)", borderRadius: 16,
                padding: "20px 22px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden"
              },
              children: [
                jsx("span", { style: { fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.06em", color: "#34d399", fontWeight: 700 }, children: "Local Drive Space" }),
                jsx("div", { style: { fontSize: "32px", fontWeight: 900, color: "#34d399", margin: "6px 0 4px 0", letterSpacing: "-0.02em" }, children: formatBytes(diskFreeBytes) }),
                jsx("span", { style: { fontSize: "13px", color: "var(--ink-2, #cdbfe0)" }, children: `${freePercent}% disk capacity available` })
              ]
            })
          ]
        }),

        // Storage Distribution Visual Bar
        jsxs("div", {
          style: {
            background: "var(--surface, #1c1034)", border: "1px solid var(--line, #32204f)", borderRadius: 16,
            padding: "20px 22px", marginBottom: 28
          },
          children: [
            jsxs("div", {
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
              children: [
                jsx("h3", { style: { margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--ink, #fff3e4)" }, children: "Storage Breakdown by Category" }),
                jsx("span", { style: { fontSize: "13px", color: "var(--ink-3, #9a8bb8)" }, children: `Total: ${formatBytes(totalFivestarBytes)}` })
              ]
            }),
            // Segmented Bar
            jsxs("div", {
              style: { width: "100%", height: "18px", borderRadius: "9px", background: "rgba(255,255,255,0.06)", display: "flex", overflow: "hidden", marginBottom: "16px" },
              children: [
                pExports > 0 && jsx("div", { title: `Rendered Exports: ${formatBytes(exportsBytes)}`, style: { width: `${pExports}%`, background: "#ec4899", transition: "width 0.3s ease" } }),
                pSource > 0 && jsx("div", { title: `Source Cuts: ${formatBytes(sourceClipsBytes)}`, style: { width: `${pSource}%`, background: "#8b5cf6", transition: "width 0.3s ease" } }),
                pRaw > 0 && jsx("div", { title: `Raw Audio/Downloads: ${formatBytes(rawBytes)}`, style: { width: `${pRaw}%`, background: "#f59e0b", transition: "width 0.3s ease" } }),
                pTemp > 0 && jsx("div", { title: `Temp Buffers & Partials: ${formatBytes(liveBuffersBytes + tempBytes)}`, style: { width: `${pTemp}%`, background: "#ef4444", transition: "width 0.3s ease" } }),
                pModels > 0 && jsx("div", { title: `AI Whisper Models: ${formatBytes(aiModelsBytes)}`, style: { width: `${pModels}%`, background: "#10b981", transition: "width 0.3s ease" } })
              ]
            }),
            // Category Legend
            jsxs("div", {
              style: { display: "flex", flexWrap: "wrap", gap: "16px 24px", fontSize: "13px" },
              children: [
                jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: 8 },
                  children: [
                    jsx("span", { style: { width: 10, height: 10, borderRadius: "50%", background: "#ec4899" } }),
                    jsx("span", { style: { color: "var(--ink-2, #cdbfe0)" }, children: "Rendered Shorts:" }),
                    jsx("strong", { style: { color: "#fff" }, children: formatBytes(exportsBytes) })
                  ]
                }),
                jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: 8 },
                  children: [
                    jsx("span", { style: { width: 10, height: 10, borderRadius: "50%", background: "#8b5cf6" } }),
                    jsx("span", { style: { color: "var(--ink-2, #cdbfe0)" }, children: "Source Cuts:" }),
                    jsx("strong", { style: { color: "#fff" }, children: formatBytes(sourceClipsBytes) })
                  ]
                }),
                jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: 8 },
                  children: [
                    jsx("span", { style: { width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" } }),
                    jsx("span", { style: { color: "var(--ink-2, #cdbfe0)" }, children: "Raw Stream Audio:" }),
                    jsx("strong", { style: { color: "#fff" }, children: formatBytes(rawBytes) })
                  ]
                }),
                jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: 8 },
                  children: [
                    jsx("span", { style: { width: 10, height: 10, borderRadius: "50%", background: "#ef4444" } }),
                    jsx("span", { style: { color: "var(--ink-2, #cdbfe0)" }, children: "Temp & Live Buffers:" }),
                    jsx("strong", { style: { color: "#fff" }, children: formatBytes(liveBuffersBytes + tempBytes) })
                  ]
                }),
                jsxs("div", {
                  style: { display: "flex", alignItems: "center", gap: 8 },
                  children: [
                    jsx("span", { style: { width: 10, height: 10, borderRadius: "50%", background: "#10b981" } }),
                    jsx("span", { style: { color: "var(--ink-2, #cdbfe0)" }, children: "AI Speech Models:" }),
                    jsx("strong", { style: { color: "#fff" }, children: formatBytes(aiModelsBytes) })
                  ]
                })
              ]
            })
          ]
        }),

        // 1-Click Quick Clean Actions Toolbar
        jsxs("div", {
          style: {
            background: "rgba(238, 63, 140, 0.08)", border: "1px solid rgba(238, 63, 140, 0.25)", borderRadius: 16,
            padding: "18px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: 32
          },
          children: [
            jsxs("div", {
              children: [
                jsx("h3", { style: { margin: "0 0 4px 0", fontSize: "16px", fontWeight: 700, color: "#fff" }, children: "⚡ Quick Space Reclaim Actions" }),
                jsx("p", { style: { margin: 0, fontSize: "13px", color: "var(--ink-3, #9a8bb8)" }, children: "Instantly clean non-essential temporary caches or heavy exported videos with 1 click." })
              ]
            }),
            jsxs("div", {
              style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
              children: [
                // Purge Temp & Live Buffers
                jsx("button", {
                  className: "btn btn-small",
                  style: { background: "rgba(239, 68, 68, 0.15)", borderColor: "rgba(239, 68, 68, 0.4)", color: "#fca5a5" },
                  onClick: handleCleanTemp,
                  disabled: actionLoading || (liveBuffersBytes + tempBytes <= 0),
                  title: "Delete rolling DVR stream segments, partial downloads & cache",
                  children: jsxs("span", {
                    style: { display: "flex", alignItems: "center", gap: 6, fontWeight: 600 },
                    children: [
                      jsx(BroomIcon, { size: 15 }),
                      `Purge Temp Buffers (${formatBytes(liveBuffersBytes + tempBytes)})`
                    ]
                  })
                }),

                // Clear All Rendered Exports
                jsx("button", {
                  className: "btn btn-small btn-primary",
                  style: { background: "linear-gradient(90deg, #ec4899 0%, #a855f7 100%)", fontWeight: 700 },
                  onClick: handleCleanAllExports,
                  disabled: actionLoading || exportsBytes <= 0,
                  title: "Safely remove finished exported MP4s (captions and clip projects remain intact)",
                  children: jsxs("span", {
                    style: { display: "flex", alignItems: "center", gap: 6 },
                    children: [
                      jsx(BroomIcon, { size: 15 }),
                      `Clear All Exports (${formatBytes(exportsBytes)})`
                    ]
                  })
                })
              ]
            })
          ]
        }),

        // Projects Section Header & Filters
        jsxs("div", {
          style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: 18 },
          children: [
            jsxs("div", {
              style: { display: "flex", alignItems: "center", gap: 12 },
              children: [
                jsx("h2", { style: { margin: 0, fontSize: "20px", fontWeight: 700, color: "var(--ink, #fff3e4)" }, children: `Streams & Projects (${filteredProjects.length})` }),
                selectedProjectIds.size > 0 && jsxs("button", {
                  className: "btn btn-small btn-danger",
                  style: { padding: "4px 12px", fontSize: "12px", fontWeight: 700 },
                  onClick: handleBulkDelete,
                  disabled: actionLoading,
                  children: [
                    jsx(TrashIcon, { size: 13 }),
                    `Delete Selected (${selectedProjectIds.size})`
                  ]
                })
              ]
            }),
            jsxs("div", {
              style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
              children: [
                // Search Input
                jsx("input", {
                  type: "search",
                  className: "input",
                  style: { padding: "6px 12px", fontSize: "13px", minWidth: "180px", background: "var(--surface-2, #281846)", border: "1px solid var(--line, #32204f)" },
                  placeholder: "Search projects…",
                  value: searchQuery,
                  onChange: e => setSearchQuery(e.target.value)
                }),
                // Filter tabs
                jsx("button", {
                  className: `btn btn-small ${filterTab === "all" ? "btn-primary" : "btn-ghost"}`,
                  onClick: () => setFilterTab("all"),
                  children: "All"
                }),
                jsx("button", {
                  className: `btn btn-small ${filterTab === "exports" ? "btn-primary" : "btn-ghost"}`,
                  onClick: () => setFilterTab("exports"),
                  children: "Has Exports"
                }),
                jsx("button", {
                  className: `btn btn-small ${filterTab === "live" ? "btn-primary" : "btn-ghost"}`,
                  onClick: () => setFilterTab("live"),
                  children: "Live Only"
                })
              ]
            })
          ]
        }),

        // Projects List Container
        jsxs("div", {
          style: { display: "flex", flexDirection: "column", gap: 14 },
          children: [
            // Select All Header Bar
            filteredProjects.length > 0 && jsxs("div", {
              style: {
                display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px",
                background: "rgba(255,255,255,0.03)", borderRadius: 10, fontSize: "13px", color: "var(--ink-3, #9a8bb8)"
              },
              children: [
                jsxs("label", {
                  style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" },
                  children: [
                    jsx("input", {
                      type: "checkbox",
                      checked: selectedProjectIds.size === filteredProjects.length && filteredProjects.length > 0,
                      onChange: () => handleSelectAll(filteredProjects)
                    }),
                    jsx("span", { children: "Select All" })
                  ]
                }),
                jsx("span", { children: "Sorted by size (largest first)" })
              ]
            }),

            // Empty State
            filteredProjects.length === 0 && jsx("div", {
              style: { textAlign: "center", padding: "48px 20px", background: "var(--surface, #1c1034)", borderRadius: 16, border: "1px dashed var(--line, #32204f)" },
              children: jsx("p", { style: { color: "var(--ink-3, #9a8bb8)", margin: 0 }, children: "No projects match the current search or filter." })
            }),

            // Project Items
            filteredProjects.map((p) => {
              const isExpanded = expandedProjects.has(p.id);
              const isSelected = selectedProjectIds.has(p.id);

              return jsxs("div", {
                key: p.id,
                style: {
                  background: "var(--surface, #1c1034)",
                  border: isSelected ? "1px solid #ec4899" : "1px solid var(--line, #32204f)",
                  borderRadius: 14,
                  overflow: "hidden",
                  transition: "border-color 0.2s ease"
                },
                children: [
                  // Main Row
                  jsxs("div", {
                    style: {
                      display: "flex", alignItems: "center", padding: "14px 18px", gap: 16, flexWrap: "wrap"
                    },
                    children: [
                      // Checkbox
                      jsx("input", {
                        type: "checkbox",
                        checked: isSelected,
                        onChange: () => toggleSelect(p.id),
                        style: { cursor: "pointer" }
                      }),

                      // Thumbnail
                      jsx("div", {
                        style: {
                          width: 84, height: 52, borderRadius: 8, overflow: "hidden", background: "#111",
                          flexShrink: 0, position: "relative"
                        },
                        children: p.thumbnail
                          ? jsx("img", { src: p.thumbnail, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } })
                          : jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666" }, children: "🎬" })
                      }),

                      // Title & Metadata
                      jsxs("div", {
                        style: { flex: 1, minWidth: 200 },
                        children: [
                          jsxs("div", {
                            style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
                            children: [
                              jsx("a", {
                                href: router.stream(p.id),
                                style: { fontWeight: 700, fontSize: "15px", color: "var(--ink, #fff3e4)", textDecoration: "none" },
                                children: p.title
                              }),
                              p.isLive && jsx("span", {
                                style: { fontSize: "10px", fontWeight: 800, padding: "2px 6px", borderRadius: 4, background: "rgba(239,68,68,0.2)", color: "#f87171", border: "1px solid rgba(239,68,68,0.4)" },
                                children: "LIVE STREAM"
                              })
                            ]
                          }),
                          jsxs("div", {
                            style: { fontSize: "12px", color: "var(--ink-3, #9a8bb8)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" },
                            children: [
                              jsx("span", { children: p.channel }),
                              jsx("span", { children: `• ${formatDate(p.createdAt)}` }),
                              jsx("span", { children: `• ${p.clipsCount} clips` })
                            ]
                          })
                        ]
                      }),

                      // Size Badges & Breakdown
                      jsxs("div", {
                        style: { textAlign: "right", marginRight: 8 },
                        children: [
                          jsx("div", {
                            style: {
                              fontSize: "16px", fontWeight: 800,
                              color: p.totalBytes > 200 * 1024 * 1024 ? "#f472b6" : p.totalBytes > 80 * 1024 * 1024 ? "#c084fc" : "#fff"
                            },
                            children: formatBytes(p.totalBytes)
                          }),
                          jsxs("div", {
                            style: { fontSize: "11px", color: "var(--ink-3, #9a8bb8)", marginTop: 3 },
                            children: [
                              p.exportsBytes > 0 && jsx("span", { style: { color: "#f472b6", marginRight: 6 }, children: `Exports: ${formatBytes(p.exportsBytes)}` }),
                              jsx("span", { children: `Clips: ${formatBytes(p.clipsBytes)}` })
                            ]
                          })
                        ]
                      }),

                      // Actions
                      jsxs("div", {
                        style: { display: "flex", alignItems: "center", gap: 8 },
                        children: [
                          // Inspect Clips Toggle
                          p.clipsCount > 0 && jsxs("button", {
                            className: "btn btn-small btn-ghost",
                            onClick: () => toggleExpand(p.id),
                            title: isExpanded ? "Collapse clips" : "Inspect individual clips",
                            style: { gap: 6, fontSize: "12px" },
                            children: [
                              `Clips (${p.clipsCount})`,
                              jsx(ChevronIcon, { open: isExpanded, size: 14 })
                            ]
                          }),

                          // Clear exports for this project
                          p.exportsBytes > 0 && jsx("button", {
                            className: "btn btn-small btn-ghost",
                            onClick: () => handleCleanProjectExports(p.id),
                            disabled: actionLoading,
                            title: `Clear exported MP4s for this project (${formatBytes(p.exportsBytes)})`,
                            style: { color: "#f472b6" },
                            children: jsx(BroomIcon, { size: 14 })
                          }),

                          // Delete Project Permanently
                          jsx("button", {
                            className: "btn btn-small btn-icon btn-ghost btn-danger",
                            onClick: () => handleDeleteProject(p.id, p.title),
                            disabled: actionLoading,
                            title: "Permanently delete this project and all its media",
                            children: jsx(TrashIcon, { size: 14 })
                          })
                        ]
                      })
                    ]
                  }),

                  // Expanded Clips Grid
                  isExpanded && jsxs("div", {
                    style: {
                      borderTop: "1px solid var(--line, #32204f)",
                      padding: "16px 20px",
                      background: "rgba(0,0,0,0.18)"
                    },
                    children: [
                      jsx("h4", {
                        style: { margin: "0 0 12px 0", fontSize: "13px", fontWeight: 700, color: "var(--ink-2, #cdbfe0)" },
                        children: `Media Files inside ${p.title} (${p.clips.length} clips):`
                      }),
                      jsx("div", {
                        style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 },
                        children: p.clips.map(c => jsxs("div", {
                          key: c.id,
                          style: {
                            background: "var(--surface-2, #281846)", border: "1px solid var(--line, #32204f)", borderRadius: 10,
                            padding: "10px", display: "flex", flexDirection: "column", gap: 8
                          },
                          children: [
                            // Clip Thumbnail
                            jsx("div", {
                              style: {
                                aspectRatio: "16/9", borderRadius: 6, overflow: "hidden", background: "#111",
                                position: "relative"
                              },
                              children: c.poster
                                ? jsx("img", { src: c.poster, alt: "", style: { width: "100%", height: "100%", objectFit: "cover" } })
                                : jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666" }, children: "🎬" })
                            }),
                            // Clip Title & Size Details
                            jsxs("div", {
                              style: { flex: 1 },
                              children: [
                                jsx("div", {
                                  style: { fontSize: "12px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                                  children: c.title
                                }),
                                jsxs("div", {
                                  style: { fontSize: "11px", color: "var(--ink-3, #9a8bb8)", marginTop: 4 },
                                  children: [
                                    jsx("div", { children: `Source cut: ${formatBytes(c.srcSize)}` }),
                                    c.hasExport
                                      ? jsx("div", { style: { color: "#f472b6", fontWeight: 600 }, children: `Exported MP4: ${formatBytes(c.exportSize)}` })
                                      : jsx("div", { style: { color: "#34d399" }, children: `No export file` })
                                  ]
                                })
                              ]
                            }),
                            // Clip Actions
                            jsxs("div", {
                              style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 },
                              children: [
                                jsx("a", {
                                  className: "btn btn-small btn-ghost",
                                  href: router.studio(p.id, c.id),
                                  style: { fontSize: "11px", padding: "3px 8px", gap: 4 },
                                  children: [
                                    jsx(EditIcon, { size: 12 }),
                                    "Edit"
                                  ]
                                }),
                                jsxs("div", {
                                  style: { display: "flex", gap: 4 },
                                  children: [
                                    c.hasExport && jsx("button", {
                                      className: "btn btn-small btn-ghost",
                                      onClick: () => handleDeleteClipExport(p.id, c.id),
                                      title: `Delete exported MP4 only (${formatBytes(c.exportSize)})`,
                                      style: { padding: "3px 6px", color: "#f472b6" },
                                      children: jsx(BroomIcon, { size: 12 })
                                    }),
                                    jsx("button", {
                                      className: "btn btn-small btn-icon btn-ghost btn-danger",
                                      onClick: () => handleDeleteClip(p.id, c.id, c.title),
                                      title: "Delete this clip completely",
                                      style: { padding: "3px 6px" },
                                      children: jsx(TrashIcon, { size: 12 })
                                    })
                                  ]
                                })
                              ]
                            })
                          ]
                        }))
                      })
                    ]
                  })
                ]
              });
            })
          ]
        }),

        // AI Models & Offline Cache Information Footer
        jsxs("div", {
          style: {
            marginTop: 40, padding: "18px 22px", background: "rgba(16, 185, 129, 0.08)",
            border: "1px solid rgba(16, 185, 129, 0.25)", borderRadius: 14, display: "flex", alignItems: "center", gap: 16
          },
          children: [
            jsx("span", { style: { fontSize: "28px" }, children: "🧠" }),
            jsxs("div", {
              children: [
                jsx("h4", { style: { margin: "0 0 4px 0", fontSize: "14px", fontWeight: 700, color: "#34d399" }, children: `Local AI Audio & Whisper Models (${formatBytes(aiModelsBytes)})` }),
                jsx("p", {
                  style: { margin: 0, fontSize: "13px", color: "var(--ink-2, #cdbfe0)", lineHeight: 1.4 },
                  children: "These ONNX models are stored locally in 'data/cache/models' to transcribe speech and generate animated captions completely offline on your computer with zero external API fees."
                })
              ]
            })
          ]
        })
      ]
    });
  }

  return {
    StorageDashboardView,
    StorageIcon
  };
}
