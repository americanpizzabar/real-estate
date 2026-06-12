import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "不動産投資判断ツール | 積算・収益・賃貸/民泊比較",
  description:
    "マイソクから積算価格・土地値比率・収益シミュレーション（賃貸/民泊）を一撃判定。プロ仕様の不動産投資分析ダッシュボード。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
