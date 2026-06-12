import { createClient, type Client } from "@libsql/client";

// =============================================================
// Turso (libSQL / SQLite) クライアント
// 環境変数 TURSO_DATABASE_URL（必須）, TURSO_AUTH_TOKEN（リモート時必須）。
// 未設定時は呼び出し側で localStorage にフォールバックする。
// =============================================================

let _client: Client | null = null;
let _schemaReady = false;

export function tursoConfigured(): boolean {
  return !!process.env.TURSO_DATABASE_URL;
}

export function getClient(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL 未設定");
    _client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _client;
}

/** テーブル/インデックスを冪等に用意する。 */
export async function ensureSchema(): Promise<void> {
  if (_schemaReady) return;
  const db = getClient();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      source_name TEXT,
      data TEXT NOT NULL
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner)`
  );
  _schemaReady = true;
}
