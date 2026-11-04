// RetroTV — plugin para Kino (API v6)
// Catálogos: FrikiSeries y Series Retro.

const FR = "https://www.frikiserie.com";
const SR = "https://seriesretro.com";

function log(...a) { try { kino.log(...a); } catch (_) {} }

function decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function plain(s) {
  return decode(String(s || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")).trim();
}

function attrs(s) {
  const o = {}, re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(s))) o[m[1].toLowerCase()] = decode(m[2] || m[3] || m[4] || "");
  return o;
}

function abs(base, u) {
  try { return new URL(u, base).href; } catch (_) { return ""; }
}

async function page(url, waitFor) {
  try {
    const r = await kino.fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", Accept: "text/html" }, timeoutMs: 12000 });
    if (r.ok) {
      const html = r.text();
      if (!waitFor || waitFor.test(html)) return html;
    }
  } catch (e) { log("fetch error", e.code || e.message); }

  try {
    const p = await kino.browser.page(url, { waitFor: waitFor ? waitFor.source : undefined, timeoutMs: 15000 });
    return p && p.html ? p.html : "";
  } catch (e) { log("browser error", e.code || e.message); return ""; }
}

function links(html, base, test) {
  const out = [], re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ""))) {
    const a = attrs(m[1]), href = abs(base, a.href);
    if (!href || !test(href)) continue;
    const title = plain(m[2]) || a.title || "";
    const im = /<img\b([^>]*)>/i.exec(m[2]), ia = im ? attrs(im[1]) : {};
    const poster = abs(base, ia.src || ia["data-src"] || ia["data-lazy-src"] || "");
    if (title && title.length > 2 && !/ver|capitulo|temporada/i.test(title)) {
      out.push({ href, title: title.slice(0, 180), poster: poster || undefined });
    }
  }
  return out;
}

function idFor(src, url) {
  let slug = "title";
  try { slug = new URL(url).pathname.split("/").filter(Boolean).pop() || slug; } catch (_) {}
  return (src === "F" ? "F-" : "S-") + slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 100);
}

function card(src, x) {
  return {
    id: idFor(src, x.href),
    ref: src + "|" + x.href,
    title: x.title.replace(/^★\s*/, "").trim(),
    kind: "series",
    poster: x.poster,
    lang: "es"
  };
}

function unique(xs) {
  const seen = new Set();
  return xs.filter(x => x && !seen.has(x.id) && seen.add(x.id));
}

// Carga múltiples páginas de FrikiSeries
async function frikiAll(maxPages = 6) {
  const list = [];
  for (let i = 1; i <= maxPages; i++) {
    const u = i === 1 ? FR + "/series/" : FR + "/series/page/" + i + "/";
    const h = await page(u, /lista-series|Todas las Series|series/i);
    if (!h) break;
    const found = links(h, FR, href => /\/(?:lista-series|serie)\//i.test(href));
    if (!found.length) break;
    list.push(...found.map(x => card("F", x)));
  }
  return unique(list);
}

// Carga múltiples páginas de Series Retro
async function retroAll(maxPages = 6) {
  const list = [];
  for (let i = 1; i <= maxPages; i++) {
    const u = i === 1 ? SR + "/" : SR + "/page/" + i + "/";
