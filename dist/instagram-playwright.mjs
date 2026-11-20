import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

let activeContext = null;
let isBusy = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
 * Launches Chrome in visible mode so the user can log in or inspect their Instagram account.
 */
export async function openInstagramBrowser(dataDir) {
  const profileDir = getProfileDir(dataDir);
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 860 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
  return { context, page };
}

/**
 * Checks if the persistent profile is currently logged in to Instagram.
 */
export async function checkLoginStatus(dataDir) {
  try {
    const profileDir = getProfileDir(dataDir);
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"]
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2000);

    // Look for create button or profile avatar indicating logged-in state
    const loggedInIndicator = await page.$(
      'svg[aria-label="New post"], svg[aria-label="Create"], svg[aria-label="Direct"], svg[aria-label="Home"], a[href*="/direct/inbox/"]'
    );
    const isLogged = Boolean(loggedInIndicator);
    await context.close();
    return { loggedIn: isLogged };
  } catch (err) {
    return { loggedIn: false, error: err.message };
  }
}

/**
 * Automates the complete Instagram Reels upload process via Playwright:
 * 1. Opens Chrome with the persistent Instagram profile.
 * 2. Verifies login (or waits for user login if needed).
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
    throw new Error("Another Instagram browser automation is already in progress. Please wait for it to finish.");
  }

  isBusy = true;
  let context = null;

  try {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found at: ${videoPath}`);
    }

    onProgress("Launching Chrome with your Instagram profile…");
    const profileDir = getProfileDir(dataDir);

    context = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: false,
      viewport: { width: 1280, height: 860 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });

    const page = context.pages()[0] || (await context.newPage());

    onProgress("Navigating to Instagram…");
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(2500);

    // Check if user is logged in
    onProgress("Checking login status…");
    let createBtn = await page.$(
      'svg[aria-label="New post"], svg[aria-label="Create"], a:has(svg[aria-label="New post"]), a:has(svg[aria-label="Create"]), div[role="button"]:has(svg[aria-label="New post"]), div[role="button"]:has(svg[aria-label="Create"]), span:has-text("Create")'
    );

    if (!createBtn) {
      onProgress("Please log in to your Instagram account in the opened Chrome window…");
      // Wait up to 90 seconds for user to log in manually
      for (let i = 0; i < 45; i++) {
        await sleep(2000);
        createBtn = await page.$(
          'svg[aria-label="New post"], svg[aria-label="Create"], a:has(svg[aria-label="New post"]), a:has(svg[aria-label="Create"]), div[role="button"]:has(svg[aria-label="New post"]), div[role="button"]:has(svg[aria-label="Create"]), span:has-text("Create")'
        );
        if (createBtn) break;
      }
    }

    if (!createBtn) {
      throw new Error("Could not find logged-in Instagram session. Please log in to Instagram in the opened browser window first.");
    }

    onProgress("Opening Create dialog…");
    await createBtn.click();
    await sleep(2000);

    // Wait for the file input in the modal
    onProgress("Selecting video file…");
    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
    if (!fileInput) {
      throw new Error("Could not locate Instagram file input element.");
    }

    await fileInput.setInputFiles(videoPath);
    onProgress("Video file attached. Waiting for video preview…");
    await sleep(4000);

    // Handle "Video posts are now shared as reels" modal if it appears
    try {
      const okModalBtn = await page.$('button:has-text("OK"), div[role="button"]:has-text("OK")');
      if (okModalBtn) {
        await okModalBtn.click();
        await sleep(1000);
      }
    } catch {}

    // Set 9:16 crop if crop button exists
    try {
      const cropBtn = await page.$('svg[aria-label="Select crop"], button[aria-label="Select crop"]');
      if (cropBtn) {
        await cropBtn.click();
        await sleep(800);
        const verticalOption = await page.$('button:has-text("9:16"), span:has-text("9:16")');
        if (verticalOption) {
          await verticalOption.click();
          await sleep(600);
        }
      }
    } catch (e) {
      console.warn("[Instagram Playwright] Crop option notice:", e.message);
    }

    // Click Next (to cover/edit screen)
    onProgress("Moving to Cover selection…");
    const nextBtn1 = await page.waitForSelector(
      'div[role="button"]:has-text("Next"), button:has-text("Next"), div[role="button"]:has-text("Weiter")',
      { timeout: 15000 }
    );
    await nextBtn1.click();
    await sleep(3000);

    // If Cover image is available, attach it in the Cover photo tab
    if (coverPath && fs.existsSync(coverPath)) {
      try {
        onProgress("Applying custom Cover image…");
        const coverTab = await page.$('div[role="tab"]:has-text("Cover photo"), button:has-text("Cover photo")');
        if (coverTab) await coverTab.click();
        await sleep(800);

        // Find file input for custom cover
        const coverInputs = await page.$$('input[type="file"]');
        for (const input of coverInputs) {
          const accept = await input.getAttribute("accept");
          if (accept && accept.includes("image")) {
            await input.setInputFiles(coverPath);
            await sleep(1500);
            break;
          }
        }
      } catch (e) {
        console.warn("[Instagram Playwright] Cover image upload notice:", e.message);
      }
    }

    // Click Next (to Caption screen)
    onProgress("Moving to Caption details…");
    const nextBtn2 = await page.waitForSelector(
      'div[role="button"]:has-text("Next"), button:has-text("Next"), div[role="button"]:has-text("Weiter")',
      { timeout: 15000 }
    );
    await nextBtn2.click();
    await sleep(3000);

    // Fill caption and hashtags
    if (caption) {
      onProgress("Typing caption and hashtags…");
      const captionBox = await page.waitForSelector(
        'div[role="textbox"][aria-label*="caption" i], div[contenteditable="true"][aria-label*="caption" i], div[contenteditable="true"]',
        { timeout: 15000 }
      );
      if (captionBox) {
        await captionBox.click();
        await sleep(500);
        // Type or paste caption
        await captionBox.fill(caption);
        await sleep(1000);
      }
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
    const shareBtn = await page.waitForSelector(
      'div[role="button"]:has-text("Share"), button:has-text("Share"), div[role="button"]:has-text("Teilen")',
      { timeout: 15000 }
    );
    await shareBtn.click();

    onProgress("Sharing Reel to Instagram… waiting for confirmation…");
    // Wait for success indicator
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
