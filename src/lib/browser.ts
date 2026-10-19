import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { Lexmount } from "lexmount";
import { chromium, type Browser } from "playwright";
import type { RunInput } from "./contracts";
import { redactInspectUrl } from "./security";

export type BrowserSession = {
  browser: Browser;
  sessionId: string | null;
  inspectUrl: string | null;
  replayUrl: string | null;
  close: () => Promise<void>;
};

async function browserExecutable(): Promise<string | undefined> {
  const explicit = process.env.CHROMIUM_EXECUTABLE_PATH ?? process.env.SITEPULSE_CHROME_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (explicit) {
    await access(explicit, constants.X_OK);
    return explicit;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    chromium.executablePath(),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed Chromium binary.
    }
  }
  return undefined;
}

export async function localBrowserAvailable(): Promise<boolean> {
  try {
    return Boolean(await browserExecutable());
  } catch {
    return false;
  }
}

export async function openBrowser(provider: RunInput["provider"]): Promise<BrowserSession> {
  if (provider === "local") {
    const executablePath = await browserExecutable();
    if (!executablePath) throw new Error("未找到 Chromium。运行 bun run browser:install，或配置 SITEPULSE_CHROME_PATH。");
    const browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-dev-shm-usage"] });
    return { browser, sessionId: null, inspectUrl: null, replayUrl: null, close: async () => { await browser.close(); } };
  }

  const apiKey = process.env.LEXMOUNT_API_KEY;
  const projectId = process.env.LEXMOUNT_PROJECT_ID;
  if (!apiKey || !projectId) throw new Error("云浏览器需要配置 LEXMOUNT_API_KEY 和 LEXMOUNT_PROJECT_ID。");
  const client = new Lexmount({ apiKey, projectId, baseUrl: process.env.LEXMOUNT_BASE_URL, timeout: 60000, logLevel: "SILENT" });
  let session: Awaited<ReturnType<typeof client.sessions.create>> | undefined;
  try {
    session = await client.sessions.create({ browserMode: "normal", recording: { persistent: true }, downloads: { enabled: false } });
    const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30000 });
    const activeSession = session;
    let closed = false;
    return {
      browser,
      sessionId: activeSession.sessionId,
      inspectUrl: activeSession.inspectUrl ? redactInspectUrl(activeSession.inspectUrl) : null,
      replayUrl: null,
      close: async () => {
        if (closed) return;
        closed = true;
        try { await browser.close(); }
        finally {
          try { await activeSession.close(); }
          finally { client.close(); }
        }
      },
    };
  } catch (error) {
    try { await session?.close(); }
    finally { client.close(); }
    throw error;
  }
}
