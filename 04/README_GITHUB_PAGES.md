# Camp Layout Lab V8 — GitHub Pages 専用版

このZIPは **GitHub Pages にそのまま置く前提** の構成です。Python、start.bat、launcher.py は不要です。

## `camp/04` に置くファイル

- `index.html`
- `app-v8.js`
- `styles-v8.css`
- `sample-layout.json`
- `.nojekyll`

`04` 内に旧 `app.js` / `styles.css` が残っていても V8 の `index.html` は参照しませんが、混乱防止のため削除して構いません。

## V8での主な修正

- GitHub Pages用の相対パスだけで動作
- `app-v8.js` / `styles-v8.css` に分離し旧版キャッシュを回避
- 3D DEMは AWS Terrarium を使用。Mapterhorn は不使用
- Open-Meteo の風APIは、選択日の1日取得を基本にし、失敗時に別方式へ自動フォールバック
- `start_date/end_date` と `past_days/forecast_days` を同一リクエストで混在させない
- 16日先までは通常予報、17〜217日先は Seasonal Forecast の ensemble mean
- 過去データは Historical Forecast → Archive の順でフォールバック
- 「通信診断」に実際のAPI URL・HTTP状態・件数を表示

## 正しくV8が公開されたか確認

画面上部に次が表示されます。

`3D SITE PLANNER · V8 · GITHUB PAGES`

DevTools Console には次が出ます。

`[CampLayout V8.0.0] loaded`
`[CampLayout V8] module .../app-v8.js?...`

旧版の `app.js:658` や `tiles.mapterhorn.com` が出る場合は、GitHub Pages がまだ旧ファイルを配信しています。GitHub Actions / Pages のデプロイ完了後に再読み込みしてください。
