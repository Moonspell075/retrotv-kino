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
    const r = await kino.fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }, timeoutMs: 12000 });
    if (r.ok) {
      const html = r.text();
      if (!waitFor || waitFor.test(html)) return html;
    }
  } catch (e) { log("fetch error", e.code || e.message); }

  try {
    const p = await kino.browser.page(url, { waitFor: waitFor ? waitFor.source : undefined, timeoutMs: 15000 });
    return p && p.html ? p.html : "";
  } catch (e) { log("browser page error", e.code || e.message); return ""; }
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
    if (title) out.push({ href, title: title.slice(0, 180), poster: poster || undefined });
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

// Carga las series aceptando tanto /lista-series/ como /serie/
async function friki(url) {
  const h = await page(url, /lista-series|Todas las Series|Capítulos|series/i);
  return links(h, FR, u => /\/(?:lista-series|serie)\//i.test(u)).map(x => card("F", x));
}

async function retro(url) {
  const h = await page(url, /\/serie\/|Últimas Series|Series Animadas/i);
  return links(h, SR, u => /\/serie\//i.test(u)).map(x => card("S", x));
}

function unpack(ref) {
  const p = String(ref || "").split("|");
  if (p.length < 2 || !["F", "S"].includes(p[0])) throw kino.error("not_found", "Referencia de serie inválida.");
  return { src: p[0], url: p.slice(1).join("|") };
}

// Extracción flexible de episodios
function getEpisodes(html, base, src) {
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, out = [], seen = new Set();
  let m, idx = 0;
  
  while ((m = re.exec(html || ""))) {
    const a = attrs(m[1]), u = abs(base, a.href);
    if (!u || seen.has(u)) continue;

    const rawText = plain(m[2]) || a.title || "";
    const combined = (rawText + " " + u).toLowerCase();

    // Detección de numeración de temporada y episodio (ej: 1x01, temp 1 cap 2, -1-1, etc.)
    const nums = /(\d{1,2})\s*[x×_.-]\s*(\d{1,3})/i.exec(combined) ||
                 /temporada[-_ ]?(\d+).*?(?:episodio|capitulo|cap)[-_ ]?(\d+)/i.exec(combined) ||
                 /(?:episodio|capitulo|cap)[-_ ]?(\d+)/i.exec(combined);

    let isEp = false;
    if (src === "S") {
      isEp = /\/episodio\//i.test(u) || (Boolean(nums) && !/\/serie\/?$/i.test(u));
    } else {
      // FrikiSeries: enlaces que tengan patrones de capítulo o números de temporada/episodio
      isEp = /\/(?:episodio|capitulo|capítulo|ver|ver-capitulo|ver-episodio)\//i.test(u) ||
             (Boolean(nums) && !/\/lista-series\/?$/i.test(u) && !u.endsWith("/series/"));
    }

    if (!isEp) continue;

    seen.add(u);
    idx++;

    let season = 1;
    let number = idx;

    if (nums) {
      if (nums.length >= 3 && nums[2]) {
        season = Math.max(1, Number(nums[1]));
        number = Math.max(1, Number(nums[2]));
      } else if (nums[1]) {
        number = Math.max(1, Number(nums[1]));
      }
    }

    const title = rawText || ("Episodio " + season + "x" + (number < 10 ? "0" + number : number));

    out.push({
      season,
      number,
      ref: src + "|ep|" + u,
      title: title.slice(0, 180)
    });
  }

  return out.sort((a, b) => a.season - b.season || a.number - b.number);
}

async function series(ref) {
  const p = unpack(ref), base = p.src === "F" ? FR : SR;
  const h = await page(p.url, /Capítulos|Episodios|Temporada|episodio|capitulo/i);
  if (!h) throw kino.error("unavailable", "No se pudo cargar la ficha de la serie.");

  const hm = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(h);
  const im = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i.exec(h);

  return {
    series: {
      title: hm ? plain(hm[1]) : "Serie",
      poster: im ? abs(base, decode(im[1])) : undefined
    },
    episodes: getEpisodes(h, base, p.src)
  };
}

export async function home() {
  const r = await Promise.all([
    friki(FR + "/series/").catch(e => { log("Friki home", e.code || e.message); return []; }),
    retro(SR + "/").catch(e => { log("Series Retro home", e.code || e.message); return []; })
  ]);
  return [
    { id: "friki", title: "FrikiSeries · Series clásicas", ref: "friki", items: unique(r[0]) },
    { id: "seriesretro", title: "Series Retro · Últimas series", ref: "seriesretro", items: unique(r[1]) }
  ];
}

export async function browse(ref) {
  if (ref === "friki") return { items: unique(await friki(FR + "/series/")) };
  if (ref === "seriesretro") return { items: unique(await retro(SR + "/")) };
  throw kino.error("not_found", "Categoría inexistente.");
}

export async function search(query) {
  const q = String(query && query.q || "").trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const r = await Promise.all([
    friki(FR + "/buscar/?q=" + enc).catch(e => { log("Friki search", e.code || e.message); return []; }),
    retro(SR + "/?s=" + enc).catch(e => { log("Series Retro search", e.code || e.message); return []; })
  ]);
  const all = unique(r.flat()), terms = q.toLowerCase().split(/\s+/);
  return all.filter(x => terms.every(w => x.title.toLowerCase().includes(w)));
}

export async function episodes(ref) {
  return series(ref);
}

export async function resolve(ref) {
  const p = String(ref || "").split("|");
  if (p.length < 3 || p[1] !== "ep" || !["F", "S"].includes(p[0])) {
    throw kino.error("not_found", "Referencia de episodio inválida.");
  }
  const url = p.slice(2).join("|");

  // Captura el tráfico de red multimedia mientras el navegador headless carga el reproductor
  const result = await kino.browser.capture(url, {
    timeoutMs: 25000,
    match: "\\.m3u8|\\.mpd|\\.mp4|master\\.txt|videoplayback|/hls/|googleapis"
  });

  if (!result.media || !result.media.length) {
    throw kino.error("unavailable", "Kino no encontró una fuente de video compatible para este episodio.");
  }

  const media = result.media;
  return {
    url: media[0].url,
    headers: media[0].headers,
    mime: media[0].mime,
    alternatives: media.slice(1, 6).map((m, i) => ({
      url: m.url,
      headers: m.headers,
      mime: m.mime,
      label: "Fuente " + (i + 2)
    })),
    subtitles: (result.subtitles || []).map(s => ({ url: s.url, lang: s.lang || "es" }))
  };
}
