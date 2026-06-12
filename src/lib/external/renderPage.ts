// =============================================================
// ヘッドレスブラウザでのページレンダリング（SPA対応の最終手段）
// 静的HTMLに物件データが無いサイト（JS描画・XHR読込）向けに、
// 実ブラウザでページを開き、描画後テキストと XHR の JSON 応答を回収する。
//
// レンダリング経路（優先順）:
//  1. リモートブラウザ: BROWSER_WS_ENDPOINT（Browserless等のWebSocket）
//     → サーバーレスの共有ライブラリ問題(libnss3等)を完全回避。最も確実。
//  2. ローカル/サーバーレス: @sparticuz/chromium（環境により不可の場合あり）
//
// ※ ページ自身が行う通信のみ（追加のクロールはしない）
// =============================================================

export interface RenderedPage {
  title: string;
  /** 描画後の可視テキスト */
  text: string;
  /** ページが取得した JSON レスポンス（候補） */
  jsonBodies: string[];
  /** 使用した描画経路 */
  via: "remote" | "local";
}

const LOCAL_CHROME_PATHS = [
  process.env.CHROME_PATH || "",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

async function resolveExecutablePath(): Promise<string> {
  const chromium = (await import("@sparticuz/chromium")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return chromium.executablePath();
  }
  const fs = await import("fs");
  for (const p of LOCAL_CHROME_PATHS) {
    if (p && fs.existsSync(p)) return p;
  }
  return chromium.executablePath();
}

export async function renderPage(url: string, timeoutMs = 25_000): Promise<RenderedPage> {
  const puppeteer = await import("puppeteer-core");
  const wsEndpoint = process.env.BROWSER_WS_ENDPOINT;

  let browser: any;
  let via: "remote" | "local";

  if (wsEndpoint) {
    // リモートブラウザに接続（Browserless / Browserbase / 自前など）
    browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
    via = "remote";
  } else {
    const chromium = (await import("@sparticuz/chromium")).default;
    const executablePath = await resolveExecutablePath();
    browser = await puppeteer.launch({
      args: [...chromium.args, "--lang=ja"],
      executablePath,
      headless: true,
      defaultViewport: { width: 1280, height: 1600 },
    });
    via = "local";
  }

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "ja,en;q=0.8" });
    page.setDefaultNavigationTimeout(timeoutMs);

    // 画像・フォント・メディアは読み込まない（高速化）。
    // リモートプロバイダによっては interception 非対応のことがあるため失敗しても続行。
    try {
      await page.setRequestInterception(true);
      page.on("request", (req: any) => {
        try {
          const t = req.resourceType();
          if (t === "image" || t === "font" || t === "media") req.abort();
          else req.continue();
        } catch {
          // 既に処理済み等は無視
        }
      });
    } catch {
      // interception不可でも描画は可能
    }

    // ページ自身が読むJSON応答を回収（物件データはここに入ることが多い）
    const jsonBodies: string[] = [];
    page.on("response", async (res: any) => {
      try {
        if (jsonBodies.length >= 12) return;
        const ct = res.headers()["content-type"] || "";
        if (!ct.includes("application/json")) return;
        const body = await res.text();
        if (body && body.length > 20 && body.length < 200_000) {
          jsonBodies.push(body.slice(0, 20_000));
        }
      } catch {
        // 読み取れないレスポンスは無視
      }
    });

    // networkidle2待ちでタイムアウトしても、描画済みの内容で続行する
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    } catch (e: any) {
      if (!String(e?.message ?? e).includes("timeout") && !String(e?.name ?? "").includes("Timeout")) {
        throw e;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));

    const title = await page.title();
    const text: string = await page.evaluate(() => (document as any).body?.innerText ?? "");

    return {
      title,
      text: text.replace(/\s+/g, " ").trim().slice(0, 8000),
      jsonBodies,
      via,
    };
  } finally {
    try {
      if (via === "remote") await browser.disconnect();
      else await browser.close();
    } catch {
      // クローズ失敗は無視
    }
  }
}
