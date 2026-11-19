// dist/storage-manager.mjs
// Dedicated backend engine for Storage Tracking, Media Breakdown & Disk Cleanup

import path from "node:path";
import fs from "node:fs";

export function registerStorageRoutes(app, deps) {
  const {
    dataDir,
    projectsDir,
    cacheDir,
    projectsMap,
    getProject,
    saveProject,
    removeProject,
    projectDir,
    clipDir
  } = deps;

  function getDirSize(dir) {
    let total = 0;
    if (!fs.existsSync(dir)) return 0;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          total += getDirSize(fullPath);
        } else {
          total += stat.size;
        }
      }
    } catch {}
    return total;
  }

  function getFileSize(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.statSync(filePath).size;
      }
    } catch {}
    return 0;
  }

  function getDiskSpace() {
    try {
      const stats = fs.statfsSync(dataDir);
      const bsize = stats.bsize || 4096;
      const total = Number(stats.blocks) * bsize;
      const free = Number(stats.bfree) * bsize;
      return {
        totalBytes: total,
        freeBytes: free,
        usedBytes: total - free
      };
    } catch (e) {
      return {
        totalBytes: 0,
        freeBytes: 0,
        usedBytes: 0
      };
    }
  }

  // 1. Comprehensive Storage Breakdown
  app.get("/api/storage/summary", async (req, res) => {
    try {
      const disk = getDiskSpace();
      const projDir = projectsDir || path.join(dataDir, "projects");
      const cDir = cacheDir || path.join(dataDir, "cache");
      const tmpDir = path.join(dataDir, "tmp");

      let categoryExports = 0;
      let countExports = 0;
      let categorySourceClips = 0;
      let countSourceClips = 0;
      let categoryRaw = 0;
      let countRaw = 0;

      const projectsList = [];

      if (fs.existsSync(projDir)) {
        const pIds = fs.readdirSync(projDir);
        for (const pId of pIds) {
          const pPath = projectDir ? projectDir(pId) : path.join(projDir, pId);
          if (!fs.existsSync(pPath) || !fs.statSync(pPath).isDirectory()) continue;

          let projectData = getProject ? getProject(pId) : null;
          if (!projectData) {
            const pJson = path.join(pPath, "project.json");
            if (fs.existsSync(pJson)) {
              try {
                projectData = JSON.parse(fs.readFileSync(pJson, "utf8"));
              } catch {}
            }
          }

          const rawDir = path.join(pPath, "raw");
          const rawSize = getDirSize(rawDir);
          if (rawSize > 0) {
            categoryRaw += rawSize;
            countRaw++;
          }

          const clipsBase = path.join(pPath, "clips");
          let pClipsSize = 0;
          let pExportsSize = 0;
          const clipsDetails = [];

          if (fs.existsSync(clipsBase)) {
            const cIds = fs.readdirSync(clipsBase);
            for (const cId of cIds) {
              const cPath = clipDir ? clipDir(pId, cId) : path.join(clipsBase, cId);
              if (!fs.existsSync(cPath) || !fs.statSync(cPath).isDirectory()) continue;

              const cSize = getDirSize(cPath);
              pClipsSize += cSize;

              const files = fs.readdirSync(cPath);
              const exportFiles = files.filter(f => f.startsWith("out-") && f.endsWith(".mp4"));
              let cExportSize = 0;
              for (const ef of exportFiles) {
                cExportSize += getFileSize(path.join(cPath, ef));
              }
              const exportThumbs = files.filter(f => f.startsWith("thumb-") && f.endsWith(".jpg"));
              for (const tf of exportThumbs) {
                cExportSize += getFileSize(path.join(cPath, tf));
              }

              if (cExportSize > 0) {
                categoryExports += cExportSize;
                countExports++;
              }

              const srcSize = getFileSize(path.join(cPath, "src.mp4"));
              if (srcSize > 0) {
                categorySourceClips += srcSize;
                countSourceClips++;
              }

              pExportsSize += cExportSize;

              const clipMeta = (projectData?.clips || []).find(c => c.id === cId) || {};
              clipsDetails.push({
                id: cId,
                title: clipMeta.meta?.title || clipMeta.cover?.text || `Clip ${cId}`,
                status: clipMeta.status || "ready",
                duration: clipMeta.src?.duration || (clipMeta.out - clipMeta.in) || 60,
                poster: clipMeta.poster ? `/files/projects/${pId}/${clipMeta.poster}` : (clipMeta.output?.thumb ? `/files/projects/${pId}/${clipMeta.output.thumb}` : ""),
                hasExport: exportFiles.length > 0,
                exportFile: exportFiles[0] || null,
                srcSize,
                exportSize: cExportSize,
                totalSize: cSize
              });
            }
          }

          const pJsonSize = getFileSize(path.join(pPath, "project.json"));
          const projectTotalSize = rawSize + pClipsSize + pJsonSize;

          projectsList.push({
            id: pId,
            title: projectData?.source?.title || pId,
            channel: projectData?.source?.channel || "Unknown",
            thumbnail: projectData?.source?.thumbnail || "",
            duration: projectData?.source?.duration || 0,
            platform: projectData?.source?.platform || "youtube",
            isLive: (projectData?.source?.title || "").startsWith("[LIVE]") || pId.startsWith("plive_"),
            createdAt: projectData?.createdAt || 0,
            status: projectData?.status || "ready",
            totalBytes: projectTotalSize,
            rawBytes: rawSize,
            clipsBytes: pClipsSize,
            exportsBytes: pExportsSize,
            clipsCount: clipsDetails.length,
            clips: clipsDetails
          });
        }
      }

      // Sort projects by total size descending
      projectsList.sort((a, b) => b.totalBytes - a.totalBytes);

      // Cache breakdown
      const liveBuffersDir = path.join(cDir, "live-buffers");
      const liveBuffersSize = getDirSize(liveBuffersDir);

      const modelsDir = path.join(cDir, "models");
      const modelsSize = getDirSize(modelsDir);

      let tmpSize = getDirSize(tmpDir);

      // Check for partial or tmp files in root dataDir
      let partialFilesSize = 0;
      let countPartials = 0;
      try {
        for (const file of fs.readdirSync(dataDir)) {
          if (file.endsWith(".part") || file.endsWith(".tmp")) {
            const sz = getFileSize(path.join(dataDir, file));
            partialFilesSize += sz;
            countPartials++;
          }
        }
      } catch {}

      const totalTempSize = tmpSize + partialFilesSize;
      const totalDataBytes = getDirSize(dataDir);
      const totalKnown = categoryExports + categorySourceClips + categoryRaw + liveBuffersSize + totalTempSize + modelsSize;
      const categoryOther = Math.max(0, totalDataBytes - totalKnown);

      // Safe reclaimable = finished exports + live buffers + temporary files + raw downloads
      const reclaimableBytes = categoryExports + liveBuffersSize + totalTempSize + categoryRaw;

      return res.json({
        ok: true,
        disk,
        fivestar: {
          totalBytes: totalDataBytes,
          reclaimableBytes,
          categories: {
            exports: {
              bytes: categoryExports,
              count: countExports,
              label: "Rendered Shorts & Videos"
            },
            sourceClips: {
              bytes: categorySourceClips,
              count: countSourceClips,
              label: "Source Video Cuts"
            },
            rawDownloads: {
              bytes: categoryRaw,
              count: countRaw,
              label: "Full Stream Audio & Downloads"
            },
            liveBuffers: {
              bytes: liveBuffersSize,
              count: fs.existsSync(liveBuffersDir) ? fs.readdirSync(liveBuffersDir).length : 0,
              label: "Rolling Live DVR Buffers"
            },
            tempFiles: {
              bytes: totalTempSize,
              count: countPartials,
              label: "Temporary Files & Partials"
            },
            aiModels: {
              bytes: modelsSize,
              count: 2,
              label: "Local AI Models (Whisper/Audio)"
            },
            other: {
              bytes: categoryOther,
              label: "Presets, Settings & App Data"
            }
          }
        },
        projects: projectsList
      });
    } catch (err) {
      console.error("[Storage API] Summary error:", err);
      return res.status(500).json({ error: err.message || "Failed to generate storage summary" });
    }
  });

  // 2. Clean Temporary Files & Live Buffers
  app.post("/api/storage/clean-temp", async (req, res) => {
    try {
      let freedBytes = 0;
      const cDir = cacheDir || path.join(dataDir, "cache");
      const liveBuffersDir = path.join(cDir, "live-buffers");
      const tmpDir = path.join(dataDir, "tmp");

      // 1. Clean live buffers
      if (fs.existsSync(liveBuffersDir)) {
        for (const item of fs.readdirSync(liveBuffersDir)) {
          const p = path.join(liveBuffersDir, item);
          freedBytes += fs.statSync(p).isDirectory() ? getDirSize(p) : getFileSize(p);
          try {
            fs.rmSync(p, { recursive: true, force: true });
          } catch {}
        }
      }

      // 2. Clean tmp dir
      if (fs.existsSync(tmpDir)) {
        for (const item of fs.readdirSync(tmpDir)) {
          const p = path.join(tmpDir, item);
          freedBytes += fs.statSync(p).isDirectory() ? getDirSize(p) : getFileSize(p);
          try {
            fs.rmSync(p, { recursive: true, force: true });
          } catch {}
        }
      }

      // 3. Clean .part and .tmp files in dataDir
      if (fs.existsSync(dataDir)) {
        for (const item of fs.readdirSync(dataDir)) {
          if (item.endsWith(".part") || item.endsWith(".tmp")) {
            const p = path.join(dataDir, item);
            freedBytes += getFileSize(p);
            try {
              fs.rmSync(p, { force: true });
            } catch {}
          }
        }
      }

      console.log(`[Storage API] Cleaned temporary buffers & caches: ${(freedBytes / (1024 * 1024)).toFixed(2)} MB freed`);
      return res.json({
        ok: true,
        freedBytes,
        message: `Successfully cleaned ${(freedBytes / (1024 * 1024)).toFixed(1)} MB of temporary data.`
      });
    } catch (err) {
      console.error("[Storage API] Clean-temp error:", err);
      return res.status(500).json({ error: err.message || "Failed to clean temporary storage" });
    }
  });

  // 3. Clean Rendered Export MP4s (Global, Per-Project, or Per-Clip)
  app.post("/api/storage/clean-exports", async (req, res) => {
    try {
      const { projectId, clipId, all } = req.body || {};
      let freedBytes = 0;
      let countRemoved = 0;
      const projDir = projectsDir || path.join(dataDir, "projects");

      const cleanProjectExports = (pId) => {
        const pPath = projectDir ? projectDir(pId) : path.join(projDir, pId);
        const clipsBase = path.join(pPath, "clips");
        if (!fs.existsSync(clipsBase)) return;

        let projectObj = getProject ? getProject(pId) : null;
        let modified = false;

        const cIds = clipId ? [clipId] : fs.readdirSync(clipsBase);
        for (const c of cIds) {
          const cPath = clipDir ? clipDir(pId, c) : path.join(clipsBase, c);
          if (!fs.existsSync(cPath) || !fs.statSync(cPath).isDirectory()) continue;

          for (const file of fs.readdirSync(cPath)) {
            if ((file.startsWith("out-") && file.endsWith(".mp4")) || (file.startsWith("thumb-") && file.endsWith(".jpg"))) {
              const fullFile = path.join(cPath, file);
              freedBytes += getFileSize(fullFile);
              try {
                fs.rmSync(fullFile, { force: true });
                countRemoved++;
              } catch {}
            }
          }

          if (projectObj?.clips) {
            const cItem = projectObj.clips.find(clip => clip.id === c);
            if (cItem && cItem.output) {
              cItem.output = undefined;
              cItem.dirty = false;
              if (cItem.status === "done") cItem.status = "ready";
              modified = true;
            }
          }
        }

        if (modified && projectObj && saveProject) {
          saveProject(projectObj, true);
        }
      };

      if (all) {
        if (fs.existsSync(projDir)) {
          for (const pId of fs.readdirSync(projDir)) {
            cleanProjectExports(pId);
          }
        }
      } else if (projectId) {
        cleanProjectExports(projectId);
      } else {
        return res.status(400).json({ error: "Specify projectId or all: true" });
      }

      console.log(`[Storage API] Cleared ${countRemoved} export files: ${(freedBytes / (1024 * 1024)).toFixed(2)} MB freed`);
      return res.json({
        ok: true,
        freedBytes,
        countRemoved,
        message: `Freed ${(freedBytes / (1024 * 1024)).toFixed(1)} MB across ${countRemoved} exported videos.`
      });
    } catch (err) {
      console.error("[Storage API] Clean-exports error:", err);
      return res.status(500).json({ error: err.message || "Failed to clear exports" });
    }
  });

  // 4. Clean Raw Stream Video & Audio Downloads from a Project
  app.post("/api/storage/clean-raw", async (req, res) => {
    try {
      const { projectId } = req.body || {};
      if (!projectId) return res.status(400).json({ error: "Project ID is required" });

      const pPath = projectDir ? projectDir(projectId) : path.join(projectsDir || path.join(dataDir, "projects"), projectId);
      const rawDir = path.join(pPath, "raw");

      let freedBytes = 0;
      if (fs.existsSync(rawDir)) {
        freedBytes = getDirSize(rawDir);
        fs.rmSync(rawDir, { recursive: true, force: true });
      }

      console.log(`[Storage API] Cleared raw stream downloads for ${projectId}: ${(freedBytes / (1024 * 1024)).toFixed(2)} MB freed`);
      return res.json({
        ok: true,
        freedBytes,
        message: `Freed ${(freedBytes / (1024 * 1024)).toFixed(1)} MB of raw stream downloads.`
      });
    } catch (err) {
      console.error("[Storage API] Clean-raw error:", err);
      return res.status(500).json({ error: err.message || "Failed to clean raw stream downloads" });
    }
  });

  // 5. Delete Entire Project Permanently
  app.delete("/api/storage/project/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const pPath = projectDir ? projectDir(id) : path.join(projectsDir || path.join(dataDir, "projects"), id);

      let freedBytes = 0;
      if (fs.existsSync(pPath)) {
        freedBytes = getDirSize(pPath);
      }

      if (removeProject) {
        removeProject(id);
      } else if (fs.existsSync(pPath)) {
        fs.rmSync(pPath, { recursive: true, force: true });
      }

      console.log(`[Storage API] Deleted project ${id} permanently: ${(freedBytes / (1024 * 1024)).toFixed(2)} MB freed`);
      return res.json({
        ok: true,
        freedBytes,
        message: `Project permanently removed (${(freedBytes / (1024 * 1024)).toFixed(1)} MB freed).`
      });
    } catch (err) {
      console.error("[Storage API] Delete project error:", err);
      return res.status(500).json({ error: err.message || "Failed to delete project" });
    }
  });

  // 6. Bulk Delete Projects
  app.post("/api/storage/bulk-delete-projects", async (req, res) => {
    try {
      const { projectIds } = req.body || {};
      if (!Array.isArray(projectIds) || projectIds.length === 0) {
        return res.status(400).json({ error: "projectIds array is required" });
      }

      let totalFreed = 0;
      let count = 0;

      for (const id of projectIds) {
        const pPath = projectDir ? projectDir(id) : path.join(projectsDir || path.join(dataDir, "projects"), id);
        if (fs.existsSync(pPath)) {
          totalFreed += getDirSize(pPath);
        }
        if (removeProject) {
          removeProject(id);
        } else if (fs.existsSync(pPath)) {
          fs.rmSync(pPath, { recursive: true, force: true });
        }
        count++;
      }

      console.log(`[Storage API] Bulk deleted ${count} projects: ${(totalFreed / (1024 * 1024)).toFixed(2)} MB freed`);
      return res.json({
        ok: true,
        deletedCount: count,
        freedBytes: totalFreed,
        message: `Permanently deleted ${count} projects (${(totalFreed / (1024 * 1024)).toFixed(1)} MB freed).`
      });
    } catch (err) {
      console.error("[Storage API] Bulk delete error:", err);
      return res.status(500).json({ error: err.message || "Failed to bulk delete projects" });
    }
  });

  // 7. Delete Single Clip Permanently
  app.delete("/api/storage/project/:projectId/clip/:clipId", async (req, res) => {
    try {
      const { projectId, clipId } = req.params;
      const cPath = clipDir ? clipDir(projectId, clipId) : path.join(projectsDir || path.join(dataDir, "projects"), projectId, "clips", clipId);

      let freedBytes = 0;
      if (fs.existsSync(cPath)) {
        freedBytes = getDirSize(cPath);
        fs.rmSync(cPath, { recursive: true, force: true });
      }

      const project = getProject ? getProject(projectId) : null;
      if (project && Array.isArray(project.clips)) {
        project.clips = project.clips.filter(c => c.id !== clipId);
        if (saveProject) saveProject(project, true);
      }

      console.log(`[Storage API] Deleted clip ${clipId} from project ${projectId}: ${(freedBytes / (1024 * 1024)).toFixed(2)} MB freed`);
      return res.json({
        ok: true,
        freedBytes,
        message: `Clip permanently deleted (${(freedBytes / (1024 * 1024)).toFixed(1)} MB freed).`
      });
    } catch (err) {
      console.error("[Storage API] Delete clip error:", err);
      return res.status(500).json({ error: err.message || "Failed to delete clip" });
    }
  });
}
