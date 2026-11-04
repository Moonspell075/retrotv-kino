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

async function fetchPage(url, waitFor) {
  try {
    const r = await kino.fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }, timeoutMs: 8000 });
    if (r.ok) {
      const html = r.text();
      if (!waitFor || waitFor.test(html)) return html;
    }
  } catch (e) { log("fetch", e.code || e.message); }

  try {
    const p = await kino.browser.page(url, { waitFor: waitFor ? waitFor.source : undefined, timeoutMs: 12000 });
    return p && p.html ? p.html : "";
  } catch (e) { log("browser page", e.code || e.message); return ""; }
}

function extractCards(html, base, test, src) {
  const out = [], re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html || ""))) {
    const a = attrs(m[1]), href = abs(base, a.href);
    if (!href || !test(href)) continue;
    const title = plain(m[2]) || a.title || "";
    const im = /<img\b([^>]*)>/i.exec(m[2]), ia = im ? attrs(im[1]) : {};
    const poster = abs(base, ia.src || ia["data-src"] || ia["data-lazy-src"] || "");
    if (title && title.length > 2 && !/ver|capitulo|temporada/i.test(title)) {
      let slug = "title";
      try { slug = new URL(href).pathname.split("/").filter(Boolean).pop() || slug; } catch (_) {}
      const id = (src === "F" ? "F-" : "S-") + slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 100);
      out.push({
        id,
        ref: src + "|" + href,
        title: title.replace(/^★\s*/, "").trim().slice(0, 180),
        kind: "series",
        poster: poster || undefined,
        lang: "es"
      });
    }
  }
  return out;
}

function unique(xs) {
  const seen = new Set();
  return xs.filter(x => x && !seen.has(x.id) && seen.add(x.id));
}

async function frikiPage(pageNum = 1) {
  const u = pageNum === 1 ? FR + "/series/" : FR + "/series/page/" + pageNum + "/";
  const h = await fetchPage(u, /lista-series|series/i);
  return extractCards(h, FR, href => /\/(?:lista-series|serie)\//i.test(href), "F");
}

async function retroPage(pageNum = 1) {
  const u = pageNum === 1 ? SR + "/" : SR + "/page/" + pageNum + "/";
  const h = await fetchPage(u, /\/serie\//i);
  return extractCards(h, SR, href => /\/serie\//i.test(href), "S");
}

async function loadMultiple(fetchFn, totalPages = 4) {
  const all = [];
  for (let i = 1; i <= totalPages; i++) {
    const items = await fetchFn(i).catch(() => []);
    if (!items.length) break;
    all.push(...items);
  }
  return unique(all);
}

function unpack(ref) {
  const p = String(ref || "").split("|");
  if (p.length < 2 || !["F", "S"].includes(p[0])) throw kino.error("not_found", "Referencia inválida.");
  return { src: p[0], url: p.slice(1).join("|") };
}

function getEpisodes(html, base, src, seriesUrl) {
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, out = [], seen = new Set();
  const cleanSeriesUrl = seriesUrl.replace(/\/+$/, "");
  let m, idx = 0;

  while ((m = re.exec(html || ""))) {
    const a = attrs(m[1]), u = abs(base, a.href);
    if (!u || seen.has(u)) continue;

    const cleanU = u.replace(/\/+$/, "");
    if (cleanU === cleanSeriesUrl) continue;

    const rawText = plain(m[2]) || a.title || "";
    const combined = (rawText + " " + u).toLowerCase();

    const sMatch = /(\d{1,2})\s*[x×_.-]\s*(\d{1,3})/i.exec(combined) ||
                   /(?:temporada|temp)[-_ ]?(\d+).*?(?:episodio|capitulo|cap)[-_ ]?(\d+)/i.exec(combined) ||
                   /\/(?:temporada|temp)-?(\d+)\/(?:capitulo|episodio)-?(\d+)/i.exec(combined);

    let isEp = false;
    let season = 1;
    let number = 0;

    if (sMatch) {
      isEp = true;
      season = Math.max(1, parseInt(sMatch[1], 10));
      number = Math.max(1, parseInt(sMatch[2], 10));
    } else {
      const epOnly = /(?:episodio|capitulo|cap)[-_ ]?(\d{1,3})/i.exec(combined);
      if (epOnly && !/temporada/i.test(rawText)) {
        isEp = true;
        season = 1;
        number = parseInt(epOnly[1], 10);
      }
    }

    if (src === "F" && (u.includes("/genero/") || u.includes("/categoria/") || u.endsWith("/series/"))) {
      isEp = false;
    }

    if (!isEp) continue;

    seen.add(u);
    idx++;
    if (!number) number = idx;

    const padEp = number < 10 ? "0" + number : number;
    const title = rawText && !/^https?:\/\//i.test(rawText) ? rawText : `Episodio ${season}x${padEp}`;

    out.push({
      season,
      number,
      ref: src + "|ep|" + u,
      title: title.slice(0, 180)
    });
  }

  return out.sort((a, b) => a.season - b.season || a.number - b.number);
}

export async function home() {
  // Carga ligera y rápida para la pantalla de inicio (evita timeout al instalar)
  const [frikis, retros] = await Promise.all([
    frikiPage(1).catch(() => []),
    retroPage(1).catch(() => [])
  ]);
  return [
    { id: "friki", title: "FrikiSeries · Series y Películas", ref: "friki", items: unique(frikis) },
    { id: "seriesretro", title: "Series Retro · Series y Películas", ref: "seriesretro", items: unique(retros) }
  ];
}

export async function browse(ref) {
  if (ref === "friki") return { items: await loadMultiple(frikiPage, 6) };
  if (ref === "seriesretro") return { items: await loadMultiple(retroPage, 6) };
  throw kino.error("not_found", "Categoría inexistente.");
}

export async function search(query) {
  const q = String(query && query.q || "").trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const r = await Promise.all([
    fetchPage(FR + "/buscar/?q=" + enc).then(h => extractCards(h, FR, u => /\/(?:lista-series|serie)\//i.test(u), "F")).catch(() => []),
    fetchPage(SR + "/?s=" + enc).then(h => extractCards(h, SR, u => /\/serie\//i.test(u), "S")).catch(() => [])
  ]);
  const all = unique(r.flat()), terms = q.toLowerCase().split(/\s+/);
  return all.filter(x => terms.every(w => x.title.toLowerCase().includes(w)));
}

export async function episodes(ref) {
  const p = unpack(ref), base = p.src === "F" ? FR : SR;
  const h = await fetchPage(p.url, /Capítulos|Episodios|Temporada|episodio|capitulo/i);
  if (!h) throw kino.error("unavailable", "No se pudo cargar la serie.");

  const hm = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(h);
  const im = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i.exec(h);

  return {
    series: {
      title: hm ? plain(hm[1]) : "Serie",
      poster: im ? abs(base, decode(im[1])) : undefined
    },
    episodes: getEpisodes(h, base, p.src, p.url)
  };
}

export async function resolve(ref) {
  const p = String(ref || "").split("|");
  if (p.length < 3 || p[1] !== "ep" || !["F", "S"].includes(p[0])) {
    throw kino.error("not_found", "Referencia inválida.");
  }
  const url = p.slice(2).join("|");

  let targetUrl = url;
  try {
    const epHtml = await fetchPage(url);
    if (epHtml) {
      const iframeMatch = /<iframe\b[^>]+src=["']([^"']*(?:streamwish|filelions|luluvdo|dood|streamtape|fembed|ok\.ru|embed|player)[^"']*)["']/i.exec(epHtml) ||
                          /<iframe\b[^>]+src=["'](https?:\/\/[^"']+)["']/i.exec(epHtml);
      if (iframeMatch && iframeMatch[1]) {
        targetUrl = abs(url, iframeMatch[1]);
      }
    }
  } catch (_) {}

  const result = await kino.browser.capture(targetUrl, {
    timeoutMs: 25000,
    match: "\\.m3u8|\\.mpd|\\.mp4|master\\.txt|videoplayback|/hls/|/stream/|googleapis"
  });

  let media = result && result.media ? result.media : [];
  if (!media.length && targetUrl !== url) {
    const fallback = await kino.browser.capture(url, {
      timeoutMs: 20000,
      match: "\\.m3u8|\\.mpd|\\.mp4|master\\.txt|videoplayback|/hls/|googleapis"
    });
    if (fallback && fallback.media) media = fallback.media;
  }

  if (!media.length) {
    throw kino.error("unavailable", "No se encontró enlace de video.");
  }

  return {
    url: media[0].url,
    headers: media[0].headers,
    mime: media[0].mime,
    alternatives: media.slice(1, 6).map((m, i) => ({
      url: m.url,
      headers: m.headers,
      mime: m.mime,
      label: "Opción " + (i + 2)
    })),
    subtitles: (result.subtitles || []).map(s => ({ url: s.url, lang: s.lang || "es" }))
  };
}
