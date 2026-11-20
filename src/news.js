// AI and agent headlines from public RSS feeds. We show only the headline, source and date, and link to the original article.
// The Daily Hallucination (src/hallucination.js) picks from these too.

export const FEEDS = [
  { source: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { source: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { source: 'VentureBeat', url: 'https://venturebeat.com/category/ai/feed/' },
  { source: 'Ars Technica', url: 'https://arstechnica.com/ai/feed/' },
  { source: 'MIT Technology Review', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
  { source: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
  { source: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function text(xml) {
  return xml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1];

// Reads RSS 2.0 <item>s and Atom <entry>s. Feeds are small and predictable, so a regex reader is enough.
export function parseFeed(xml, source) {
  const items = [];
  for (const [, block] of xml.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)>/gi)) {
    const title = text(tag(block, 'title') ?? '');
    const link = text(tag(block, 'link') ?? '') || block.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '';
    const date = new Date(text(tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated') ?? tag(block, 'dc:date') ?? ''));
    if (!title || !/^https?:\/\//i.test(link)) continue;
    // Skip paid "sponsored" posts some feeds mix in.
    if (/\/spons(ored)?\//.test(link)) continue;
    // A short summary, used only as background for The Daily Hallucination writer. It's never shown on the site.
    // Some feeds escape the HTML in descriptions, so strip tags a second time once it's decoded.
    const summary = text(text(tag(block, 'description') ?? tag(block, 'summary') ?? '')).slice(0, 400);
    items.push({ title, link, source, date: isNaN(date) ? null : date, summary });
  }
  return items;
}

export async function fetchFeed({ url, source }) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AgentParrot/1.0 (+https://agentparrot.ai/news)', Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`${source} feed returned ${res.status}`);
  return parseFeed(await res.text(), source);
}

// Fetches every feed, drops any that fail, and returns the newest headlines first (at most `perSource` from each site).
export async function latestHeadlines({ feeds = FEEDS, fetcher = fetchFeed, perSource = 8, maxAgeDays = 30 } = {}) {
  const cutoff = Date.now() - maxAgeDays * 864e5;
  const results = await Promise.allSettled(feeds.map((f) => fetcher(f)));
  const items = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') return console.warn(`News feed skipped: ${feeds[i].source}: ${r.reason?.message}`);
    const fresh = r.value.filter((it) => it.date && it.date.getTime() >= cutoff).sort((a, b) => b.date - a.date);
    items.push(...fresh.slice(0, perSource));
  });
  const seen = new Set();
  return items
    .sort((a, b) => b.date - a.date)
    .filter((it) => !seen.has(it.link) && seen.add(it.link));
}

// Keeps headlines in memory for a while so each visit doesn't refetch every feed.
export function cachedHeadlines({ ttlMs = 30 * 60e3, load = latestHeadlines } = {}) {
  let cache = null;
  return async () => {
    if (cache && Date.now() - cache.at < ttlMs) return cache.items;
    const items = await load();
    // Don't cache an empty result, so a brief outage doesn't blank the page for half an hour.
    if (items.length) cache = { at: Date.now(), items };
    return items;
  };
}
