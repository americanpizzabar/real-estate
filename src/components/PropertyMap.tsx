"use client";
import React from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// =============================================================
// GIS地図（Leaflet + 国土地理院タイル / APIキー不要）
// ベース地図（淡色/標準/写真）＋ハザード（洪水/津波/土砂/高潮）を
// レイヤーで重畳表示。対象物件にマーカーを立てる。
// ※ Leafletはwindow依存のため、page側で dynamic(ssr:false) で読み込む。
// =============================================================

const GSI = "https://cyberjapandata.gsi.go.jp/xyz";
const DISA = "https://disaportaldata.gsi.go.jp/raster";
const GSI_ATTR =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>';

export default function PropertyMap({
  lat,
  lon,
  label,
}: {
  lat: number;
  lon: number;
  label: string;
}) {
  const elRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);

  React.useEffect(() => {
    if (!elRef.current || mapRef.current) return;

    const pale = L.tileLayer(`${GSI}/pale/{z}/{x}/{y}.png`, { attribution: GSI_ATTR, maxZoom: 18 });
    const std = L.tileLayer(`${GSI}/std/{z}/{x}/{y}.png`, { attribution: GSI_ATTR, maxZoom: 18 });
    const photo = L.tileLayer(`${GSI}/seamlessphoto/{z}/{x}/{y}.jpg`, { attribution: GSI_ATTR, maxZoom: 18 });

    const map = L.map(elRef.current, {
      center: [lat, lon],
      zoom: 16,
      layers: [pale],
    });
    mapRef.current = map;

    // ハザードオーバーレイ（半透明）
    const hazardOpts = { opacity: 0.55, maxZoom: 18, attribution: GSI_ATTR };
    const flood = L.tileLayer(`${DISA}/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png`, hazardOpts);
    const tsunami = L.tileLayer(`${DISA}/04_tsunami_newlegend_data/{z}/{x}/{y}.png`, hazardOpts);
    const landslide = L.tileLayer(`${DISA}/05_dosyakeikai_keikaikuiki_data/{z}/{x}/{y}.png`, hazardOpts);
    const hightide = L.tileLayer(`${DISA}/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png`, hazardOpts);

    // 既定で洪水を重ねる
    flood.addTo(map);

    L.control
      .layers(
        { "地図（淡色）": pale, "地図（標準）": std, "航空写真": photo },
        {
          "洪水浸水想定": flood,
          "津波浸水想定": tsunami,
          "土砂災害警戒区域": landslide,
          "高潮浸水想定": hightide,
        },
        { collapsed: false }
      )
      .addTo(map);

    // 物件マーカー（CSS製の丸ピン。画像依存を避ける）
    const icon = L.divIcon({
      className: "",
      html: `<div style="width:18px;height:18px;border-radius:50%;background:#4f9cf9;border:3px solid #fff;box-shadow:0 0 0 2px #4f9cf9,0 2px 6px rgba(0,0,0,.5)"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    L.marker([lat, lon], { icon }).addTo(map).bindPopup(label).openPopup();

    // コンテナサイズ確定後の再描画
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lon, label]);

  return <div ref={elRef} className="w-full h-full rounded-lg overflow-hidden" style={{ minHeight: 480 }} />;
}
