'use strict';

const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const parser = new Parser({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; AWSCloudNewsBot/1.0)',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  },
  customFields: {
    item: [['content:encoded', 'contentEncoded']],
  },
});

const FEEDS = [
  {
    url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
    source: "AWS What's New",
  },
  {
    url: 'https://aws.amazon.com/blogs/aws/feed/',
    source: 'AWS News Blog',
  },
  {
    url: 'https://aws.amazon.com/blogs/architecture/feed/',
    source: 'AWS Architecture Blog',
  },
  {
    url: 'https://aws.amazon.com/blogs/security/feed/',
    source: 'AWS Security Blog',
  },
];

const MAX_ITEMS = 30;
const SNIPPET_MAX = 260;

/** Strip HTML tags and decode common HTML entities */
function stripHtml(raw) {
  if (!raw) return '';
  return raw
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&#x2019;/g, '\u2019')
    .replace(/&#8216;|&#x2018;/g, '\u2018')
    .replace(/&#8220;|&#x201C;/g, '\u201C')
    .replace(/&#8221;|&#x201D;/g, '\u201D')
    .replace(/&#8230;|&#x2026;/g, '\u2026')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract a clean plain-text snippet from a feed item */
function extractSnippet(item) {
  const candidates = [
    item.contentSnippet,
    item.contentEncoded,
    item.content,
    item.summary,
  ];
  for (const src of candidates) {
    if (!src) continue;
    const clean = stripHtml(src);
    if (clean.length > 30) {
      return clean.length > SNIPPET_MAX
        ? clean.slice(0, SNIPPET_MAX).replace(/\s+\S*$/, '') + '\u2026'
        : clean;
    }
  }
  return '';
}

/** Fetch and parse one RSS feed, returning normalised item objects */
async function fetchFeed({ url, source }) {
  process.stdout.write(`  Fetching ${source}... `);
  try {
    const feed = await parser.parseURL(url);
    const items = feed.items.map((item) => ({
      title: stripHtml(item.title || '').replace(/\s+/g, ' ').trim(),
      link: (item.link || item.guid || '').trim(),
      source,
      pubDate: item.isoDate || item.pubDate || new Date().toISOString(),
      snippet: extractSnippet(item),
    }));
    console.log(`\u2713 ${items.length} items`);
    return items;
  } catch (err) {
    console.log(`\u2717 ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('AWS Cloud News Fetcher');
  console.log('='.repeat(44));

  const results = await Promise.all(FEEDS.map(fetchFeed));
  const all = results.flat();

  // Deduplicate by canonical URL
  const seen = new Set();
  const unique = all.filter((item) => {
    if (!item.link || seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });

  // Sort newest-first
  unique.sort(
    (a, b) =>
      new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  );

  const items = unique.slice(0, MAX_ITEMS);

  const output = {
    lastUpdated: new Date().toISOString(),
    items,
  };

  const outPath = path.resolve(__dirname, '..', 'news.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log('='.repeat(44));
  console.log(`\u2713 Wrote ${items.length} items \u2192 news.json`);
  console.log(`  Last updated: ${output.lastUpdated}`);

  // Per-source breakdown
  const counts = {};
  items.forEach((i) => {
    counts[i.source] = (counts[i.source] || 0) + 1;
  });
  console.log('\n  Breakdown by source:');
  Object.entries(counts).forEach(([src, n]) =>
    console.log(`    ${src}: ${n}`)
  );
}

main().catch((err) => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
