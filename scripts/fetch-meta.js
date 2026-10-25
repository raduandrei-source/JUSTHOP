#!/usr/bin/env node
// Extrage metadatele unui link (YouTube, Udemy, Coursera sau articol) ca JSON, pentru completarea automată în lot.
//   node scripts/fetch-meta.js <url>
// Nu inventează nimic: ce nu găsește rămâne null. Categoriile, nivelul și descrierea în română le completează Claude după.
const url = process.argv[2];
if (!url) { console.error('Folosire: node scripts/fetch-meta.js <url>'); process.exit(1); }

const UA = 'Mozilla/5.0 (justhop metadata)';
const decode = s => s && s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const meta = (html, prop) => {
  const m = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)
    || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i').exec(html);
  return m ? decode(m[1]) : null;
};

async function youtube() {
  const out = { url, platform: 'YouTube', title: null, author: null, authorUrl: null, min: null, views: null, pub: null, desc: null, ok: false };
  const o = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url));
  if (o.ok) {
    const j = await o.json();
    out.title = j.title; out.author = j.author_name; out.authorUrl = j.author_url; out.ok = true;
  }
  try {
    const html = await (await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' } })).text();
    const secs = /"lengthSeconds":"(\d+)"/.exec(html);
    const views = /"viewCount":"(\d+)"/.exec(html);
    const pub = /"publishDate":"(\d{4}-\d{2}-\d{2})/.exec(html) || /"uploadDate":"(\d{4}-\d{2}-\d{2})/.exec(html);
    if (secs) out.min = Math.round(Number(secs[1]) / 60);
    if (views) out.views = Number(views[1]);
    if (pub) out.pub = pub[1];
    out.desc = meta(html, 'og:description');
  } catch { /* oEmbed rămâne valabil */ }
  return out;
}

async function page() {
  const out = { url, platform: 'Articol', title: null, author: null, authorUrl: null, min: null, views: null, pub: null, rating: null, desc: null, ok: false };
  const host = new URL(url).hostname;
  if (/udemy\.com/.test(host)) out.platform = 'Udemy';
  if (/coursera\.org/.test(host)) out.platform = 'Coursera';
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, 'accept-language': 'en' } });
  out.status = res.status;
  const html = await res.text();
  out.ok = res.ok;
  out.title = meta(html, 'og:title') || decode((/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1]);
  out.desc = meta(html, 'og:description') || meta(html, 'description');
  out.author = meta(html, 'author') || meta(html, 'article:author') || meta(html, 'og:site_name');
  out.pub = (meta(html, 'article:published_time') || '').slice(0, 10) || null;
  const rating = /"ratingValue":\s*"?([\d.]+)"?/.exec(html);
  if (rating) out.rating = Number(rating[1]);
  return out;
}

(async () => {
  try {
    const isYt = /(?:youtube\.com|youtu\.be)/.test(new URL(url).hostname);
    console.log(JSON.stringify(await (isYt ? youtube() : page()), null, 2));
  } catch (e) {
    console.log(JSON.stringify({ url, ok: false, error: String(e.cause?.code || e.message) }, null, 2));
  }
})();
