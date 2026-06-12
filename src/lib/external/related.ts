// 関連リンク（同一物件の他サイト掲載・横断探索）の型。

export interface RelatedLink {
  url: string;
  title?: string;
  /** ポータル名（判別できた場合） */
  portal?: string;
  /**
   * same-page    : 取得ページ内に存在した他ポータルへのリンク
   * search-result: 検索API（設定時）で見つかった実在の掲載URL
   * search-link  : 自動生成したクロスポータル検索リンク（クリックで検索）
   */
  kind: "same-page" | "search-result" | "search-link";
}
