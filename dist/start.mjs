#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(import.meta.dirname, "..");
const markerPath = path.join(rootDir, ".setup_done");

// Check if all dependencies in package.json are actually installed in node_modules
function areDependenciesInstalled() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    const deps = Object.keys(pkg.dependencies || {});
    for (const dep of deps) {
      const depPkg = path.join(rootDir, "node_modules", dep, "package.json");
      if (!fs.existsSync(depPkg)) return false;
    }
    return deps.length > 0;
  } catch {
    return false;
  }
}

function runNpm(args) {
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/c", "npm", ...args], {
      stdio: "inherit",
      cwd: rootDir,
    });
  }
  return spawnSync("npm", args, {
    stdio: "inherit",
    cwd: rootDir,
  });
}

const depsOk = areDependenciesInstalled();
const setupDone = fs.existsSync(markerPath);

if (!depsOk || !setupDone) {
  console.log("\n========================================================");
  console.log("  First-time setup detected. Setting up Fivestar...");
  console.log("  This will only happen once.");
  console.log("========================================================\n");

  if (!depsOk) {
    console.log("[1/2] Installing dependencies (npm ci --omit=dev)...");
    let ci = runNpm(["ci", "--omit=dev"]);
    if (ci.status !== 0) {
      console.log("\n[INFO] npm ci failed or package-lock mismatch. Trying npm install --omit=dev...");
      let install = runNpm(["install", "--omit=dev"]);
      if (install.status !== 0) {
        console.error("\n[ERROR] Failed to install npm dependencies.");
        process.exit(1);
      }
    }
  } else {
    console.log("[1/2] Dependencies already installed.");
  }

  console.log("\n[2/2] Setting up tools, fonts and assets (npm run setup)...");
  let setup = runNpm(["run", "setup"]);
  if (setup.status !== 0) {
    console.warn("\n[WARNING] Setup finished with warnings, continuing startup...");
  }

  try {
    fs.writeFileSync(markerPath, "setup_completed\n", "utf8");
  } catch (err) {
    console.warn("Could not write .setup_done marker:", err.message);
  }

  console.log("\n========================================================");
  console.log("  Setup complete! Starting Fivestar...");
  console.log("========================================================\n");
}

// Now launch the server
await import("./server.mjs");
