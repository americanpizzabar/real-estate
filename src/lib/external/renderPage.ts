// =============================================================
// ヘッドレスブラウザでのページレンダリング（SPA対応の最終手段）
// 静的HTMLに物件データが無いサイト（JS描画・XHR読込）向けに、
// 実ブラウザでページを開き、描画後テキストと XHR の JSON 応答を回収する。
//
// - Vercel: @sparticuz/chromium のサーバーレス用バイナリを使用
// - ローカル: CHROME_PATH 環境変数 or 一般的なChromeパスを探索
// - ページ自身が行う通信のみ（追加のクロールはしない）
// =============================================================

export interface RenderedPage {
  title: string;
  /** 描画後の可視テキスト */
  text: string;
  /** ページが取得した JSON レスポンス（候補） */
  jsonBodies: string[];
}

const LOCAL_CHROME_PATHS = [
  process.env.CHROME_PATH || "",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

async function resolveExecutablePath(): Promise<string> {
  // サーバーレス（Vercel/AWS）では @sparticuz/chromium を使用
  const chromium = (await import("@sparticuz/chromium")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return chromium.executablePath();
  }
  // ローカル: システムChromeを探索、無ければ sparticuz を試す
  const fs = await import("fs");
  for (const p of LOCAL_CHROME_PATHS) {
    if (p && fs.existsSync(p)) return p;
  }
  return chromium.executablePath();
}

export async function renderPage(url: string, timeoutMs = 25_000): Promise<RenderedPage> {
  const puppeteer = await import("puppeteer-core");
  const chromium = (await import("@sparticuz/chromium")).default;

  const executablePath = await resolveExecutablePath();
  const browser = await puppeteer.launch({
    args: [...chromium.args, "--lang=ja"],
    executablePath,
    headless: true,
    defaultViewport: { width: 1280, height: 1600 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({ "Accept-Language": "ja,en;q=0.8" });

    // 画像・フォント・メディアは読み込まない（高速化）
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const t = req.resourceType();
      if (t === "image" || t === "font" || t === "media") req.abort();
      else req.continue();
    });

    // ページ自身が読むJSON応答を回収（物件データはここに入ることが多い）
    const jsonBodies: string[] = [];
    page.on("response", async (res) => {
      try {
        if (jsonBodies.length >= 10) return;
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

    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    // 描画完了の猶予（クライアントレンダリング分）
    await new Promise((r) => setTimeout(r, 1500));

    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText ?? "");

    return {
      title,
      text: text.replace(/\s+/g, " ").trim().slice(0, 8000),
      jsonBodies,
    };
  } finally {
    await browser.close();
  }
}
