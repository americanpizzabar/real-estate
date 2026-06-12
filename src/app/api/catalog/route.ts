import { NextRequest, NextResponse } from "next/server";
import { tursoConfigured, getClient, ensureSchema } from "@/lib/db/turso";
import type { CatalogItem } from "@/lib/catalog";

// =============================================================
// 物件カタログ永続化 API（Turso/libSQL）
//   GET    /api/catalog?owner=KEY        → 一覧
//   POST   /api/catalog  {owner, item}   → upsert
//   PATCH  /api/catalog  {owner, id, status}
//   DELETE /api/catalog?owner=KEY&id=ID
// Turso未設定時は 503（クライアントは localStorage にフォールバック）。
// =============================================================

export const dynamic = "force-dynamic";

function notConfigured() {
  return NextResponse.json({ configured: false, error: "Turso未設定" }, { status: 503 });
}

function rowToItem(row: any): CatalogItem {
  const data = JSON.parse(String(row.data));
  return {
    id: String(row.id),
    createdAt: Number(row.created_at),
    status: String(row.status) as CatalogItem["status"],
    sourceName: row.source_name ? String(row.source_name) : undefined,
    property: data.property,
    extras: data.extras ?? {},
    tags: data.tags ?? [],
    snapshot: data.snapshot,
  };
}

export async function GET(req: NextRequest) {
  if (!tursoConfigured()) return notConfigured();
  const owner = req.nextUrl.searchParams.get("owner");
  if (!owner) return NextResponse.json({ error: "owner required" }, { status: 400 });
  try {
    await ensureSchema();
    const db = getClient();
    const rs = await db.execute({
      sql: "SELECT * FROM properties WHERE owner = ? ORDER BY created_at DESC",
      args: [owner],
    });
    return NextResponse.json({ configured: true, items: rs.rows.map(rowToItem) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "db error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!tursoConfigured()) return notConfigured();
  const { owner, item } = await req.json().catch(() => ({}));
  if (!owner || !item?.id) {
    return NextResponse.json({ error: "owner と item が必要です" }, { status: 400 });
  }
  try {
    await ensureSchema();
    const db = getClient();
    const data = JSON.stringify({
      property: item.property,
      extras: item.extras ?? {},
      tags: item.tags ?? [],
      snapshot: item.snapshot,
    });
    await db.execute({
      sql: `INSERT INTO properties (id, owner, created_at, status, source_name, data)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              status = excluded.status,
              source_name = excluded.source_name,
              data = excluded.data`,
      args: [
        item.id,
        owner,
        item.createdAt ?? Date.now(),
        item.status ?? "reviewing",
        item.sourceName ?? null,
        data,
      ],
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "db error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!tursoConfigured()) return notConfigured();
  const { owner, id, status } = await req.json().catch(() => ({}));
  if (!owner || !id || !status) {
    return NextResponse.json({ error: "owner, id, status が必要です" }, { status: 400 });
  }
  try {
    await ensureSchema();
    const db = getClient();
    await db.execute({
      sql: "UPDATE properties SET status = ? WHERE id = ? AND owner = ?",
      args: [status, id, owner],
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "db error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!tursoConfigured()) return notConfigured();
  const owner = req.nextUrl.searchParams.get("owner");
  const id = req.nextUrl.searchParams.get("id");
  if (!owner || !id) {
    return NextResponse.json({ error: "owner と id が必要です" }, { status: 400 });
  }
  try {
    await ensureSchema();
    const db = getClient();
    await db.execute({
      sql: "DELETE FROM properties WHERE id = ? AND owner = ?",
      args: [id, owner],
    });
    return NextResponse.json({ configured: true, ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "db error" }, { status: 500 });
  }
}
