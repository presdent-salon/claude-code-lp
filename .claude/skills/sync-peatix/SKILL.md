---
description: Peatixから開催日程を取得してLP HTMLを自動更新する
user_invocable: true
---

# sync-peatix

Peatixイベントページから開催日程をスクレイピングし、LP1/LP2のHTMLを更新するスキル。

## 手順

1. スクリプトを実行して日程を取得・更新する:

```bash
node scripts/fetch-peatix-dates.mjs
```

- `--dry-run` オプションで更新せずに日程だけ確認できる
- LP1/LP2両方のHTMLが自動更新される（ページ内の2箇所の日程セクション両方）
- `scripts/peatix-dates.json` に取得データが保存される

2. 実行結果をユーザーに報告する:
   - 各LPで取得された日程一覧
   - 更新の成否

3. 更新後はユーザーにコミット・デプロイの要否を確認する

## 設定変更時

PeatixのイベントURLが変わった場合は `scripts/fetch-peatix-dates.mjs` 内の `LP_CONFIG` を編集する。

## 前提

- `playwright` パッケージがインストール済みであること（`npm install`）
- Chromiumブラウザがインストール済みであること（`npx playwright install chromium`）
