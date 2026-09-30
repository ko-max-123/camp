# Camp Dashboard prototype

無料枠・静的ホスティングで動かすキャンプ向け統合ダッシュボードです。

## 主な機能

- キャンプ場 / 市町村 / 地名検索
- 現在地取得
- 現在天気 + 7日予報
- 12時間の雨・風タイムライン
- 夕方〜夜の焚き火「気象条件」表示
- 日の出・日の入り
- 夜の星空コンディション概算
- 夜間の結露リスク概算
- ポータブル電源 + ソーラー発電概算
- 周辺8kmのスーパー、コンビニ、ガソリン、病院、温泉、ホームセンター検索
- PWA用 manifest / Service Worker

## 無料構成

- Open-Meteo Geocoding API
- Open-Meteo Forecast API
- OpenStreetMap Nominatim（Open-Meteoで地点が見つからない場合のユーザー操作時フォールバック）
- OpenStreetMap Overpass API（周辺施設ボタンを押した時だけ）
- GitHub Pages 等の静的ホスティング

APIキーは不要です。

## 配置

フォルダ一式をGitHub Pagesへ配置してください。

ローカルで `index.html` を直接開いても基本UIは確認できますが、ブラウザのCORSや位置情報・Service Worker制限があるため、実動確認はHTTPSのGitHub Pagesを推奨します。

## 指数について

「総合」「星空」「結露」「焚き火気象」は、このプロトタイプ独自の簡易計算です。公的な警報、火気規制、キャンプ場管理者の判断を置き換えるものではありません。
