import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import { parseSeminarSchedule } from './memo.js';

// 壊れた/空のデータで data.txt を上書きしないためのサニティチェック
function runSanityChecks(newText) {
  const errors = [];
  if (newText.length < 5000) errors.push(`data.txt が小さすぎます (${newText.length} bytes)`);
  if (!newText.includes('今後の予定')) errors.push('『今後の予定』が見当たりません(構造変化の可能性)');
  const seminars = parseSeminarSchedule(newText);
  if (seminars.length < 50) errors.push(`抽出セミナー件数が異常です (${seminars.length}件)`);
  try {
    const prev = fs.readFileSync('data.txt', 'utf-8');
    if (prev.length > 5000 && newText.length < prev.length * 0.5) {
      errors.push(`サイズが前回比で半減しています (${prev.length} → ${newText.length})`);
    }
  } catch { /* 初回は前回データ無し */ }
  return { errors, seminars };
}

const ROOT_URL = 'https://sites.google.com/view/tokyo-probability-seminar23';
const SITE_ORIGIN = 'https://sites.google.com';
const SITE_PATH_PREFIX = '/view/tokyo-probability-seminar23';

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

function normalizeUrl(rawUrl) {
  try {
    const normalized = new URL(rawUrl, ROOT_URL);
    normalized.hash = '';

    if (normalized.origin !== SITE_ORIGIN) {
      return null;
    }

    if (!normalized.pathname.startsWith(SITE_PATH_PREFIX)) {
      return null;
    }

    if (normalized.searchParams.get('authuser') !== '0') {
      normalized.searchParams.set('authuser', '0');
    }

    return normalized.toString();
  } catch {
    return null;
  }
}

function collectInternalLinks($) {
  const links = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) {
      return;
    }

    const normalized = normalizeUrl(href);
    if (normalized) {
      links.add(normalized);
    }
  });

  return [...links];
}

function extractPageLabel($, url) {
  const title = $('title').first().text().trim();
  if (title) {
    return title.replace(/\s*-\s*Google Sites?$/i, '').trim();
  }

  return url.replace(`${SITE_ORIGIN}${SITE_PATH_PREFIX}`, '').replace('?authuser=0', '') || 'トップページ';
}

function extractSections($) {
  const sections = [];

  $('section').each((_, el) => {
    const sectionText = $(el).text().replace(/\s+/g, ' ').trim();
    if (sectionText.length > 10) {
      sections.push(sectionText);
    }
  });

  if (sections.length === 0) {
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    if (bodyText.length > 10) {
      sections.push(bodyText);
    }
  }

  return sections;
}

async function fetchPage(url) {
  console.log(`${url} から情報を取得中...`);

  const { data } = await axios.get(url, {
    headers: REQUEST_HEADERS
  });

  const $ = cheerio.load(data);
  const label = extractPageLabel($, url);
  const sections = extractSections($);
  const links = collectInternalLinks($);

  if (sections.length === 0) {
    throw new Error(`${label} から本文を抽出できませんでした`);
  }

  return {
    label,
    sections,
    links,
  };
}

async function scrape() {
  const results = [];
  const failures = [];
  const visited = new Set();
  const queue = [normalizeUrl(ROOT_URL)].filter(Boolean);

  while (queue.length > 0) {
    const url = queue.shift();
    if (!url || visited.has(url)) {
      continue;
    }

    visited.add(url);

    try {
      const page = await fetchPage(url);
      results.push(`【${page.label}】\nURL: ${url}\n\n${page.sections.join('\n\n')}`);

      for (const link of page.links) {
        if (!visited.has(link)) {
          queue.push(link);
        }
      }
    } catch (error) {
      failures.push(`- ${url}: ${error.message}`);
      console.error(`❌ ${url} の取得に失敗しました:`, error.message);
    }
  }

  if (results.length === 0) {
    console.error('❌ すべてのページのスクレイプに失敗しました。');
    process.exit(1);
  }

  const text = [
    '【東京確率論セミナー スクレイプ結果】',
    `取得ページ数: ${results.length}`,
    '',
    ...results,
  ].join('\n\n');

  const { errors, seminars } = runSanityChecks(text);
  if (errors.length > 0) {
    console.error('❌ サニティチェック失敗。data.txt を更新しません:');
    console.error(errors.join('\n'));
    process.exit(1);
  }

  fs.writeFileSync('data.txt', text);

  // データ鮮度メタ(サーバが as-of 表示・staleness 判定に使う)
  const nowMs = Date.now();
  const future = seminars.filter((s) => Number.isFinite(s.endTimestamp) && s.endTimestamp >= nowMs);
  fs.writeFileSync('freshness.json', JSON.stringify({
    scrapedAtJST: new Date().toISOString(),
    pageCount: results.length,
    seminarCount: seminars.length,
    futureCount: future.length,
    latestFutureDate: future[0]?.dateLabel ?? null,
  }, null, 2));

  console.log('✅ セミナー情報を data.txt に保存完了！');
  console.log(`  セミナー ${seminars.length}件 / 今後の予定 ${future.length}件`);
  console.log('内容プレビュー:', text.substring(0, 200) + '...');

  if (failures.length > 0) {
    console.log('⚠️ 一部のページ取得に失敗しました:');
    console.log(failures.join('\n'));
  }
}

scrape();
