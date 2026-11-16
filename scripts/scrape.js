import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseSeminarSchedule } from '../src/seminars/schedule.js';
import { extractSections, getCurrentScheduleUrl } from '../src/seminars/source.js';
import { DATA_DIR } from '../src/paths.js';

// 壊れた/空のデータで data.txt を上書きしないためのサニティチェック
function runSanityChecks(newText, previousText) {
  const errors = [];
  if (newText.length < 5000) errors.push(`data.txt が小さすぎます (${newText.length} bytes)`);
  if (!newText.includes('今後の予定')) errors.push('『今後の予定』が見当たりません(構造変化の可能性)');
  const seminars = parseSeminarSchedule(newText);
  if (seminars.length < 50) errors.push(`抽出セミナー件数が異常です (${seminars.length}件)`);
  if (previousText.length > 5000 && newText.length < previousText.length * 0.5) {
    errors.push(`サイズが前回比で半減しています (${previousText.length} → ${newText.length})`);
  }
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

    if (normalized.pathname !== SITE_PATH_PREFIX && !normalized.pathname.startsWith(`${SITE_PATH_PREFIX}/`)) {
      return null;
    }

    normalized.search = '';
    normalized.searchParams.set('authuser', '0');

    return normalized.toString();
  } catch {
    return null;
  }
}

function savedPages(text) {
  const markers = [...text.matchAll(/^【[^\n】]+】\r?\nURL:\s*(https?:\/\/\S+)[^\S\n]*\r?\n/gmu)];
  const pages = new Map();
  for (let index = 0; index < markers.length; index += 1) {
    const url = normalizeUrl(markers[index][1]);
    if (url) pages.set(url, text.slice(markers[index].index, markers[index + 1]?.index ?? text.length).trim());
  }
  return pages;
}

function saveSnapshot(outputDir, text, freshness) {
  const files = [
    [path.join(outputDir, 'data.txt'), text],
    [path.join(outputDir, 'freshness.json'), JSON.stringify(freshness, null, 2)],
  ];
  const temporary = files.map(([filename]) => `${filename}.${process.pid}.tmp`);
  try {
    // Prepare both files before replacing either; freshness is replaced last.
    files.forEach(([, content], index) => fs.writeFileSync(temporary[index], content));
    files.forEach(([filename], index) => fs.renameSync(temporary[index], filename));
  } finally {
    temporary.forEach((filename) => { if (fs.existsSync(filename)) fs.unlinkSync(filename); });
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

async function fetchPage(url) {
  console.log(`${url} から情報を取得中...`);

  const { data } = await axios.get(url, {
    headers: REQUEST_HEADERS,
    timeout: 15000,
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

export async function scrape({ now = new Date(), outputDir = DATA_DIR, fetchPageImpl = fetchPage } = {}) {
  const results = [];
  const failures = [];
  const retainedArchiveUrls = [];
  const dataPath = path.join(outputDir, 'data.txt');
  const previousText = fs.existsSync(dataPath) ? fs.readFileSync(dataPath, 'utf-8') : '';
  const previousPages = savedPages(previousText);
  const visited = new Set();
  const currentUrl = normalizeUrl(getCurrentScheduleUrl(now));
  const currentYear = Number(getCurrentScheduleUrl(now).match(/\/(\d{4})年度$/u)[1]);
  const rootUrl = normalizeUrl(ROOT_URL);
  const queue = [currentUrl, rootUrl, ...previousPages.keys()].filter(Boolean);
  let currentPageLoaded = false;

  while (queue.length > 0) {
    const url = queue.shift();
    if (!url || visited.has(url)) {
      continue;
    }

    visited.add(url);

    try {
      const page = await fetchPageImpl(url);
      if (url === currentUrl) {
        const currentText = page.sections.join('\n\n');
        const currentRecords = parseSeminarSchedule(currentText).filter((seminar) =>
          (seminar.year === currentYear && seminar.month >= 4)
          || (seminar.year === currentYear + 1 && seminar.month <= 3));
        if (!currentText.includes('今後の予定') || !currentRecords.length) {
          throw new Error('現在年度の予定を読み取れませんでした');
        }
        currentPageLoaded = true;
      }
      let content = page.sections.join('\n\n');
      if (url === rootUrl) {
        // The dedicated year page is authoritative; the home page may lag it.
        const scheduleStart = content.indexOf('今後の予定');
        if (scheduleStart >= 0) content = content.slice(0, scheduleStart).trim();
      } else if (url !== currentUrl && previousPages.has(url)) {
        const before = parseSeminarSchedule(previousPages.get(url)).length;
        if (before && parseSeminarSchedule(content).length < before * 0.5) {
          throw new Error('保存済みのアーカイブと比べて講演情報が不足しています');
        }
      }
      results.push(`【${page.label}】\nURL: ${url}\n\n${content}`);

      for (const link of page.links) {
        if (!visited.has(link)) {
          queue.push(link);
        }
      }
    } catch (error) {
      failures.push(`- ${url}: ${error.message}`);
      console.error(`❌ ${url} の取得に失敗しました:`, error.message);
      if (url === currentUrl) throw new Error('現在年度のページを取得できませんでした。保存済みのデータを保持します。');
      if (previousPages.has(url)) {
        let cached = previousPages.get(url);
        if (url === rootUrl && cached.includes('今後の予定')) cached = cached.slice(0, cached.indexOf('今後の予定')).trim();
        results.push(cached);
        retainedArchiveUrls.push(url);
      } else {
        throw new Error('未保存のページを取得できませんでした。保存済みのデータを保持します。');
      }
    }
  }

  if (!currentPageLoaded) {
    throw new Error('現在年度のページを取得できませんでした。保存済みのデータを保持します。');
  }

  const text = [
    '【東京確率論セミナー スクレイプ結果】',
    `取得ページ数: ${results.length}`,
    '',
    ...results,
  ].join('\n\n');

  const { errors, seminars } = runSanityChecks(text, previousText);
  if (errors.length > 0) {
    throw new Error(`サニティチェック失敗。data.txt を更新しません:\n${errors.join('\n')}`);
  }

  // データ鮮度メタ(サーバが as-of 表示・staleness 判定に使う)
  const nowMs = now.getTime();
  const future = seminars.filter((s) => Number.isFinite(s.endTimestamp) && s.endTimestamp >= nowMs);
  const freshness = {
    scrapedAtJST: new Date().toISOString(),
    sourceUrl: currentUrl,
    pageCount: results.length,
    retainedArchivePages: retainedArchiveUrls.length,
    seminarCount: seminars.length,
    futureCount: future.length,
    latestFutureDate: future[0]?.dateLabel ?? null,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  saveSnapshot(outputDir, text, freshness);

  console.log('✅ セミナー情報を data.txt に保存完了！');
  console.log(`  セミナー ${seminars.length}件 / 今後の予定 ${future.length}件`);
  console.log('内容プレビュー:', text.substring(0, 200) + '...');

  if (failures.length > 0) {
    console.log('⚠️ 一部のページ取得に失敗しました:');
    console.log(failures.join('\n'));
  }
  return { seminars, freshness, retainedArchiveUrls };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  scrape().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}
