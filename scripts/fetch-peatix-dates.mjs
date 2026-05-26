#!/usr/bin/env node
/**
 * Peatixイベントページから開催日時を取得し、LP HTMLを更新するスクリプト
 * 使い方: node scripts/fetch-peatix-dates.mjs [--dry-run]
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// LP設定: peatixURL → HTMLファイルパス
const LP_CONFIG = [
  {
    name: 'lp1',
    peatixUrl: 'https://peatix.com/event/5021235/view',
    htmlPath: resolve(ROOT, 'lp1/index.html'),
  },
  {
    name: 'lp2',
    peatixUrl: 'https://peatix.com/event/5022847/view',
    htmlPath: resolve(ROOT, 'lp1/lp2/index.html'),
  },
];

async function fetchDatesFromPeatix(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });

  // 「開催日時の選択」セクションのカード要素を取得
  const dates = await page.evaluate(() => {
    // Peatixの日程選択カードからデータを抽出
    const cards = document.querySelectorAll('[class*="session-card"], [class*="date-card"], [class*="DateSelector"] li, [class*="date-selector"] li');
    if (cards.length > 0) {
      return Array.from(cards).map(card => ({
        text: card.textContent.trim(),
      }));
    }

    // フォールバック: ページ全体から日程パターンを探す
    const body = document.body.innerText;
    return [{ rawText: body }];
  });

  return dates;
}

async function fetchDatesWithRetry(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  // 日程選択エリアが表示されるまで待つ
  await page.waitForTimeout(2000);

  const result = await page.evaluate(() => {
    const body = document.body.innerText;

    // 「開催日時の選択」セクション以降のテキストを取得
    const sectionMatch = body.match(/開催日時の選択([\s\S]*?)(?:チケット|申し込む|参加費|詳細)/);
    const sectionText = sectionMatch ? sectionMatch[1] : body;

    // 日程パターンを抽出: 「曜日 + 月 + 日 + 時刻」
    const datePattern = /(月曜日|火曜日|水曜日|木曜日|金曜日|土曜日|日曜日)\s*(\d{1,2})月\s*(\d{1,2})\s*(午前|午後)(\d{1,2}):(\d{2})/g;
    const dates = [];
    let match;

    while ((match = datePattern.exec(sectionText)) !== null) {
      const dayOfWeek = match[1].replace('曜日', '');
      const month = parseInt(match[2]);
      const day = parseInt(match[3]);
      const ampm = match[4];
      const hour = parseInt(match[5]);
      const minute = match[6];

      // 24時間制に変換
      let hour24;
      if (ampm === '午前') {
        hour24 = hour === 12 ? 0 : hour;
      } else {
        hour24 = hour === 12 ? 12 : hour + 12;
      }

      const timeStr = `${hour24}:${minute}`;

      dates.push({
        dayOfWeek,
        month,
        day,
        time: timeStr,
        display: `${month}月${day}日（${dayOfWeek}）`,
      });
    }

    return { dates, debugText: sectionText.substring(0, 500) };
  });

  return result;
}

function generateScheduleHtml(dates, peatixUrl) {
  return dates.map(d => {
    return `      <a href="${peatixUrl}" class="sdate" target="_blank" rel="noopener">
        <div class="sdate-info">
          <div>
            <div class="sdate-date">${d.display}</div>
            <div class="sdate-time">${d.time}〜</div>
          </div>
        </div>
        <div class="sdate-badge">残席あり</div>
      </a>`;
  }).join('\n');
}

function updateHtml(htmlPath, peatixUrl, newDatesHtml) {
  let html = readFileSync(htmlPath, 'utf-8');

  // schedule-dates内のコンテンツを置換（同じPeatix URLのセクションのみ）
  // パターン: <div class="schedule-dates"> ... </div> の中身を置換
  const regex = new RegExp(
    `(<div class="schedule-dates">\\s*)((?:<a href="${peatixUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[\\s\\S]*?<\\/a>\\s*)+)(\\s*<\\/div>)`,
    'g'
  );

  const updated = html.replace(regex, `$1\n${newDatesHtml}\n    $3`);

  if (updated === html) {
    console.log(`  ⚠ No changes made to ${htmlPath}`);
    return false;
  }

  writeFileSync(htmlPath, updated, 'utf-8');
  return true;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      locale: 'ja-JP',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
    const page = await context.newPage();

    for (const lp of LP_CONFIG) {
      console.log(`\n📅 ${lp.name}: ${lp.peatixUrl}`);
      const result = await fetchDatesWithRetry(page, lp.peatixUrl);

      if (result.dates.length === 0) {
        console.log(`  ❌ 日程が取得できませんでした`);
        console.log(`  Debug: ${result.debugText}`);
        continue;
      }

      console.log(`  取得した日程:`);
      result.dates.forEach(d => console.log(`    ${d.display} ${d.time}〜`));

      if (dryRun) {
        console.log(`  [dry-run] HTMLの更新をスキップ`);
        continue;
      }

      const newHtml = generateScheduleHtml(result.dates, lp.peatixUrl);
      const changed = updateHtml(lp.htmlPath, lp.peatixUrl, newHtml);
      console.log(changed ? `  ✅ HTML更新完了` : `  ⚠ 変更なし`);
    }

    // JSON出力（CI連携用）
    const allDates = {};
    for (const lp of LP_CONFIG) {
      const result = await fetchDatesWithRetry(page, lp.peatixUrl);
      allDates[lp.name] = result.dates;
    }
    writeFileSync(resolve(ROOT, 'scripts/peatix-dates.json'), JSON.stringify(allDates, null, 2));
    console.log('\n📄 scripts/peatix-dates.json に日程データを保存');

  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
