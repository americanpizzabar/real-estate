import {
  type CatalogItem,
  type PropertyStatus,
  loadCatalog,
  upsertItem as upsertLocal,
  updateItem as updateLocal,
  deleteItem as deleteLocal,
} from "./catalog";

// =============================================================
// カタログ永続化ストア（クライアント）
// Turso(API)が利用可能ならサーバ永続化、未設定/失敗時は localStorage。
// 認証は未導入のため、端末ごとの匿名 owner キーで分離する。
// （将来サインインを入れれば owner をユーザーIDに差し替え可能）
// =============================================================

export type StoreMode = "turso" | "local";

let mode: StoreMode | null = null;

function ownerKey(): string {
  if (typeof window === "undefined") return "anon";
  let k = window.localStorage.getItem("fudosan_owner");
  if (!k) {
    k = `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage.setItem("fudosan_owner", k);
  }
  return k;
}

export function getMode(): StoreMode | null {
  return mode;
}

/** 一覧取得。サーバが使えれば turso、ダメなら local。modeを確定する。 */
export async function fetchCatalog(): Promise<{ mode: StoreMode; items: CatalogItem[] }> {
  try {
    const res = await fetch(`/api/catalog?owner=${encodeURIComponent(ownerKey())}`);
    if (res.ok) {
      const data = await res.json();
      if (data.configured) {
        mode = "turso";
        return { mode, items: data.items ?? [] };
      }
    }
  } catch {
    // ネットワーク不可 → ローカル
  }
  mode = "local";
  return { mode, items: loadCatalog() };
}

export async function saveItem(item: CatalogItem): Promise<CatalogItem[]> {
  if (mode === "turso") {
    try {
      await fetch("/api/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: ownerKey(), item }),
      });
      const { items } = await fetchCatalog();
      return items;
    } catch {
      // フォールバック
    }
  }
  return upsertLocal(item);
}

export async function patchStatus(id: string, status: PropertyStatus): Promise<CatalogItem[]> {
  if (mode === "turso") {
    try {
      await fetch("/api/catalog", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: ownerKey(), id, status }),
      });
      const { items } = await fetchCatalog();
      return items;
    } catch {
      // フォールバック
    }
  }
  return updateLocal(id, { status });
}

export async function removeItem(id: string): Promise<CatalogItem[]> {
  if (mode === "turso") {
    try {
      await fetch(
        `/api/catalog?owner=${encodeURIComponent(ownerKey())}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const { items } = await fetchCatalog();
      return items;
    } catch {
      // フォールバック
    }
  }
  return deleteLocal(id);
}
