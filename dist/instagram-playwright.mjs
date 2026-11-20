import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const CDP_PORT = 9222;
let isBusy = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Returns the path to the installed Google Chrome or Microsoft Edge binary on Windows.
 */
function getBrowserExecutablePath() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
}

/**
 * Returns the directory used for the dedicated Instagram automated Chrome profile.
 */
export function getProfileDir(dataDir) {
  const dir = path.join(dataDir, "instagram-chrome-profile");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Checks if Chrome remote debugging port is open and responding.
 */
async function isPortOpen(port = CDP_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Cleans up stale lockfiles if no Chrome process is currently listening on CDP port.
 */
function cleanStaleLockfile(profileDir) {
  const lock = path.join(profileDir, "lockfile");
  if (fs.existsSync(lock)) {
    try {
      fs.unlinkSync(lock);
    } catch {}
  }
}

/**
 * Connects to an existing Chrome instance on CDP_PORT, or spawns a fresh Chrome window
 * with a persistent profile on CDP_PORT. This avoids the Windows ProcessSingleton lock collision
 * and avoids the '--no-sandbox' unsupported flag warning banner completely.
 */
export async function ensureBrowser(dataDir) {
  const profileDir = getProfileDir(dataDir);
  const open = await isPortOpen(CDP_PORT);

  if (open) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      return browser;
    } catch (e) {
      console.warn("[Instagram Playwright] Could not connect to existing CDP port, will respawn:", e.message);
    }
  }

  // Clean stale lockfile if Chrome is not listening
  cleanStaleLockfile(profileDir);

  const chromeExe = getBrowserExecutablePath();
  const child = spawn(
    chromeExe,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "https://www.instagram.com/"
    ],
    {
      detached: true,
      stdio: "ignore"
    }
  );
  child.unref();

  // Wait up to 15 seconds for Chrome to bind CDP port
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (await isPortOpen(CDP_PORT)) {
      break;
    }
  }

  return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
}

/**
 * Launches or focuses Chrome in visible mode so the user can log in to Instagram.
 */
export async function openInstagramBrowser(dataDir) {
  const browser = await ensureBrowser(dataDir);
  const context = browser.contexts()[0] || (await browser.newContext());
  let page = context.pages().find((p) => p.url().includes("instagram.com"));
  if (!page) {
    page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  } else {
    await page.bringToFront();
  }
  return { browser, page };
}

/**
 * Checks if the persistent profile is currently logged in to Instagram.
 */
export async function checkLoginStatus(dataDir) {
  try {
    const browser = await ensureBrowser(dataDir);
    const context = browser.contexts()[0] || (await browser.newContext());
    let page = context.pages().find((p) => p.url().includes("instagram.com"));
    if (!page) {
      page = context.pages()[0] || (await context.newPage());
      await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(2000);
    }

    const loggedInIndicator = await page.$(
      'svg[aria-label="New post"], svg[aria-label="Create"], svg[aria-label="Direct"], svg[aria-label="Home"], a[href*="/direct/inbox/"]'
    );
    return { loggedIn: Boolean(loggedInIndicator) };
  } catch (err) {
    return { loggedIn: false, error: err.message };
  }
}

/**
 * Automates the complete Instagram Reels upload process via Playwright over CDP:
 * 1. Connects to or spawns Chrome without sandbox warnings or profile lock collisions.
 * 2. Checks login (prompts if not logged in).
 * 3. Opens the Create modal.
 * 4. Injects the MP4 video file.
 * 5. Sets 9:16 vertical crop.
 * 6. Attaches Cover image (if available).
 * 7. Fills caption and hashtags.
 * 8. Submits the Reel (if autoShare is true).
 */
export async function uploadReelWithPlaywright({
  dataDir,
  videoPath,
  coverPath,
  caption,
  autoShare = true,
  onProgress = () => {}
}) {
  if (isBusy) {
    throw new Error("Another Instagram browser automation is currently running. Please wait for it to finish.");
  }

  isBusy = true;

  try {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found at: ${videoPath}`);
    }

    onProgress("Connecting to Chrome on your computer…");
    const browser = await ensureBrowser(dataDir);
    const context = browser.contexts()[0] || (await browser.newContext());

    let page = context.pages().find((p) => p.url().includes("instagram.com"));
    if (!page) {
      page = context.pages()[0] || (await context.newPage());
      onProgress("Navigating to Instagram…");
      await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(2500);
    } else {
      await page.bringToFront();
      if (!page.url().includes("instagram.com")) {
        await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
        await sleep(2500);
      }
    }

    // Check if user is logged in
    onProgress("Checking login status…");
    let createBtn = await page.$(
      'svg[aria-label="New post"], svg[aria-label="Create"], a:has(svg[aria-label="New post"]), a:has(svg[aria-label="Create"]), div[role="button"]:has(svg[aria-label="New post"]), div[role="button"]:has(svg[aria-label="Create"]), span:has-text("Create")'
    );

    if (!createBtn) {
      onProgress("Please log in to your Instagram account in the opened Chrome window…");
      // Wait up to 90 seconds for user to log in
      for (let i = 0; i < 45; i++) {
        await sleep(2000);
        createBtn = await page.$(
          'svg[aria-label="New post"], svg[aria-label="Create"], a:has(svg[aria-label="New post"]), a:has(svg[aria-label="Create"]), div[role="button"]:has(svg[aria-label="New post"]), div[role="button"]:has(svg[aria-label="Create"]), span:has-text("Create")'
        );
        if (createBtn) break;
      }
    }

    if (!createBtn) {
      throw new Error(
        "Instagram is not logged in. Please log in to your Instagram account in the opened Chrome window and click Upload again."
      );
    }

    // Check if modal with file input is already open in the page
    let fileInput = page.locator('input[type="file"]').first();
    const isFileInputAlreadyAttached = (await fileInput.count()) > 0;

    if (!isFileInputAlreadyAttached) {
      onProgress("Opening Create dialog…");
      await createBtn.click();
      await sleep(1500);

      // In Instagram web, clicking "New post" / "Create" often opens a popover submenu
      // containing "Post" and "AI content". We must click "Post" to trigger the upload modal.
      try {
        const postMenuItem = page
          .locator(
            'span:text-is("Post"), div[role="button"]:has-text("Post"), a:has-text("Post"), button:has-text("Post")'
          )
          .first();
        if (await postMenuItem.isVisible({ timeout: 2500 }).catch(() => false)) {
          await postMenuItem.click({ force: true });
          await sleep(1500);
        }
      } catch (e) {
        console.warn("[Instagram Playwright] Popover menu check notice:", e.message);
      }
    }

    // Wait for file input in modal (Must use state: 'attached' because Instagram hides <input type="file"> with CSS)
    onProgress("Selecting video file…");
    fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: "attached", timeout: 25000 });
    await fileInput.setInputFiles(videoPath);
    onProgress("Video file attached. Waiting for video preview…");
    await sleep(4000);

    // Handle "Video posts are now shared as reels" modal if it appears
    try {
      const okModalBtn = page.locator('button:has-text("OK"), div[role="button"]:has-text("OK")').first();
      if (await okModalBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        await okModalBtn.click();
        await sleep(1000);
      }
    } catch {}

    // Set 9:16 crop if crop option button exists
    try {
      const cropBtn = page
        .locator('svg[aria-label="Select crop"], button[aria-label="Select crop"], div[role="button"]:has(svg[aria-label="Select crop"])')
        .first();
      if (await cropBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cropBtn.click();
        await sleep(800);
        const verticalOption = page.locator('button:has-text("9:16"), span:has-text("9:16"), div[role="button"]:has-text("9:16")').first();
        if (await verticalOption.isVisible({ timeout: 2000 }).catch(() => false)) {
          await verticalOption.click();
          await sleep(600);
        }
      }
    } catch (e) {
      console.warn("[Instagram Playwright] Crop option notice:", e.message);
    }

    // Click Next (to cover/edit screen)
    onProgress("Moving to Cover selection…");
    const nextBtn1 = page
      .locator('div[role="button"]:has-text("Next"), button:has-text("Next"), div[role="button"]:has-text("Weiter")')
      .first();
    await nextBtn1.waitFor({ state: "visible", timeout: 25000 });
    await nextBtn1.click();
    await sleep(3000);

    // If Cover image is available, attach it in Cover photo tab
    if (coverPath && fs.existsSync(coverPath)) {
      try {
        onProgress("Applying custom Cover image…");
        const coverTab = page
          .locator('div[role="tab"]:has-text("Cover photo"), button:has-text("Cover photo"), div[role="button"]:has-text("Cover photo")')
          .first();
        if (await coverTab.isVisible({ timeout: 3000 }).catch(() => false)) {
          await coverTab.click();
          await sleep(1000);
        }

        const coverInput = page.locator('input[type="file"][accept*="image"]').first();
        if (await coverInput.count()) {
          await coverInput.setInputFiles(coverPath);
          await sleep(1500);
        } else {
          const allInputs = await page.locator('input[type="file"]').all();
          for (const input of allInputs) {
            const accept = await input.getAttribute("accept");
            if (accept && accept.includes("image")) {
              await input.setInputFiles(coverPath);
              await sleep(1500);
              break;
            }
          }
        }
      } catch (e) {
        console.warn("[Instagram Playwright] Cover image upload notice:", e.message);
      }
    }

    // Click Next (to Caption screen)
    onProgress("Moving to Caption details…");
    const nextBtn2 = page
      .locator('div[role="button"]:has-text("Next"), button:has-text("Next"), div[role="button"]:has-text("Weiter")')
      .first();
    await nextBtn2.waitFor({ state: "visible", timeout: 25000 });
    await nextBtn2.click();
    await sleep(3000);

    // Fill caption and hashtags
    if (caption) {
      onProgress("Typing caption and hashtags…");
      const captionBox = page
        .locator(
          'div[role="textbox"][aria-label*="caption" i], div[contenteditable="true"][aria-label*="caption" i], div[contenteditable="true"]'
        )
        .first();
      await captionBox.waitFor({ state: "visible", timeout: 25000 });
      await captionBox.click();
      await sleep(500);
      try {
        await captionBox.fill(caption);
      } catch {
        await page.keyboard.insertText(caption);
      }
      await sleep(1000);
    }

    if (!autoShare) {
      onProgress("Reel is prepared with video, cover, and caption! Click Share in Chrome whenever you're ready.");
      return {
        ok: true,
        readyToShare: true,
        message: "Reel prepared with video, cover & caption. Review and click Share in the opened Chrome window."
      };
    }

    // Auto-click Share
    onProgress("Clicking Share…");
    const shareBtn = page
      .locator('div[role="button"]:has-text("Share"), button:has-text("Share"), div[role="button"]:has-text("Teilen")')
      .first();
    await shareBtn.waitFor({ state: "visible", timeout: 25000 });
    await shareBtn.click();

    onProgress("Sharing Reel to Instagram… waiting for confirmation…");
    await page.waitForSelector(
      'span:has-text("Your reel has been shared"), span:has-text("Reel shared"), span:has-text("Post shared"), svg[aria-label="Animated checkmark"]',
      { timeout: 90000 }
    );

    onProgress("Reel published successfully!");
    await sleep(3000);

    return {
      ok: true,
      published: true,
      message: "Reel successfully published to Instagram via automated browser!"
    };
  } finally {
    isBusy = false;
  }
}
