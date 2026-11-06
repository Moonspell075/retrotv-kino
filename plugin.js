// RetroTV 1.3.9 — Kino API v6
// Catálogo separado por fuente y tipo. Paginación progresiva y episodios agrupados por temporada.
// La reproducción solo usa medios compatibles que Kino pueda detectar sin eludir controles de acceso.

const FR = "https://www.frikiserie.com";
const SR = "https://seriesretro.com";

function log(...a) { try { kino.log("RetroTV", ...a); } catch (_) {} }
function decode(s) {
  return String(s || "").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&nbsp;/g," ");
}
function plain(s) {
  return decode(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]*>/g," ").replace(/\s+/g," ")).trim();
}
function attrs(s) {
  const o={}, re=/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g; let m;
  while((m=re.exec(s||""))) o[m[1].toLowerCase()]=decode(m[2]||m[3]||m[4]||"");
  return o;
}
function abs(base,u) { try { return new URL(u,base).href; } catch(_) { return ""; } }
function slug(s) {
  return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9_-]+/g,"-").replace(/^-|-$/g,"").slice(0,100)||"item";
}
async function page(url, waitFor, forceBrowser) {
  // FrikiSeries hidrata sus listados con JavaScript: en esas rutas el HTML inicial
  // puede parecer válido aunque todavía no contenga tarjetas reales.
  if(forceBrowser && kino.browser && kino.browser.page) {
    try {
      const p=await kino.browser.page(url,{timeoutMs:22000,waitFor:waitFor?(waitFor.source||String(waitFor)):undefined});
      if(p&&p.html) return p.html;
    } catch(e) { log("browser.page",url,e&&e.message); }
  }
  try {
    const r=await kino.fetch(url,{headers:{"User-Agent":"Mozilla/5.0","Accept":"text/html"},timeoutMs:12000});
    if(r&&r.ok) {
      const h=typeof r.text==="function"?r.text():r.text;
      if(h&&(!waitFor||new RegExp(waitFor.source||waitFor,"i").test(h))) return h;
    }
  } catch(e) { log("fetch",url,e&&e.message); }
  if(!forceBrowser && kino.browser && kino.browser.page) {
    try {
      const p=await kino.browser.page(url,{timeoutMs:20000,waitFor:waitFor||undefined});
      if(p&&p.html) return p.html;
    } catch(e) { log("browser.page",url,e&&e.message); }
  }
  return "";
}
function itemKind(path, source, requested) {
  if(requested) return requested;
  if(/pel[ií]cula|movie|film/i.test(path)) return "movie";
  return "series";
}
function cards(html,base,source,requested) {
  const out=[],seen=new Set(),re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let m;
  while((m=re.exec(html||""))) {
    const a=attrs(m[1]), href=abs(base,a.href||a["data-href"]);
    if(!href||seen.has(href)) continue;
    let path=""; try { path=new URL(href).pathname; } catch(_) {}
    const frSeries=/\/lista-series\//i.test(path);
    const frMovie=/\/ver-serie\//i.test(path);
    const movie=source==="F"?(requested==="movie"&&frMovie):/pel[ií]cula|movie|film/i.test(path);
    const series=source==="F"?(requested==="series"&&frSeries):/serie|show|temporada/i.test(path);
    if(requested==="movie"&&!movie) continue;
    if(requested==="series"&&!series) continue;
    if(!requested&&!movie&&!series) continue;
    const im=/<img\b([^>]*)>/i.exec(m[2]), ia=im?attrs(im[1]):{};
    const poster=abs(base,ia.src||ia["data-src"]||ia["data-lazy-src"]||ia["data-original"]||"");
    const title=(plain(m[2])||a.title||a["aria-label"]||"").trim();
    if(!title||title.length<2||/ver m[aá]s|siguiente|anterior/i.test(title)) continue;
    seen.add(href);
    const kind=itemKind(path,source,requested);
    out.push({id:source+"-"+kind+"-"+slug(path.split("/").filter(Boolean).pop()),
      ref:source+"|"+kind+"|"+href,title:title.slice(0,180),kind,poster:poster||undefined,lang:"es"});
  }
  return out;
}
function unique(xs) { const s=new Set(); return (xs||[]).filter(x=>x&&!s.has(x.id)&&s.add(x.id)); }
function baseUrl(source,kind) {
  if(source==="F") return FR+(kind==="movie"?"/peliculas/":"/series/");
  return SR+(kind==="movie"?"/todas-las-peliculas/":"/");
}
function pageUrl(source,kind,n,categoryUrl) {
  const base=categoryUrl||baseUrl(source,kind);
  if(n<=1) return base;
  if(/\/page\/\d+\/?$/i.test(base)) return base.replace(/\/page\/\d+\/?$/i,"/page/"+n+"/");
  return base.replace(/\/?$/,"/")+"page/"+n+"/";
}
async function listPage(source,kind,n,categoryUrl) {
  const u=pageUrl(source,kind,n,categoryUrl);
  const contentLink=source==="F"
    ? (kind==="movie"
      ? /(?:href|data-href)\s*=\s*["'][^"']*\/ver-serie\//i
      : /(?:href|data-href)\s*=\s*["'][^"']*\/lista-series\//i)
    : /(?:href|data-href)\s*=\s*["'][^"']*\/(?:serie|movie)\//i;
  const h=await page(u,contentLink,source==="F");
  const parsed=unique(cards(h,source==="F"?FR:SR,source,kind));
  log("catalogo",source,kind,"pagina",n,"resultados",parsed.length,"url",u);
  return {items:parsed,url:u};
}
function categoryRef(source,kind,url) { return "cat|"+source+"|"+kind+"|"+(url||""); }
function parseCategory(ref) {
  const p=String(ref||"").split("|");
  if(p[0]!=="cat"||!["F","S"].includes(p[1])||!["movie","series"].includes(p[2])) return null;
  return {source:p[1],kind:p[2],url:p.slice(3).join("|")};
}
function parseItem(ref) {
  const p=String(ref||"").split("|");
  if(!["F","S"].includes(p[0])||!["movie","series","ep"].includes(p[1])) return null;
  return {source:p[0],kind:p[1],url:p.slice(2).join("|")};
}
export async function home() {
  const defs=[
    ["fr-movies","FrikiSeries · Películas","F","movie"],
    ["fr-series","FrikiSeries · Series","F","series"],
    ["sr-movies","Series Retro · Películas","S","movie"],
    ["sr-series","Series Retro · Series","S","series"]
  ];
  const rows=await Promise.all(defs.map(async d=>{
    const p=await listPage(d[2],d[3],1);
    return {id:d[0],title:d[1],ref:categoryRef(d[2],d[3],""),genre:d[3]==="movie"?"peliculas":"series",items:p.items.slice(0,60)};
  }));
  return rows.filter(r=>r.items.length);
}
export async function categories() {
  const out=[
    {id:"fr-movies",title:"FrikiSeries · Películas",ref:categoryRef("F","movie",""),genre:"peliculas"},
    {id:"fr-series",title:"FrikiSeries · Series",ref:categoryRef("F","series",""),genre:"series"},
    {id:"sr-movies",title:"Series Retro · Películas",ref:categoryRef("S","movie",""),genre:"peliculas"},
    {id:"sr-series",title:"Series Retro · Series",ref:categoryRef("S","series",""),genre:"series"}
  ];
  // Descubre enlaces de género/categoría visibles en el menú de Series Retro.
  const h=await page(SR+"/",/género|genero|categor[ií]a|pel[ií]cula|serie/i);
  const re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let m; const seen=new Set();
  while((m=re.exec(h||""))) {
    const a=attrs(m[1]),u=abs(SR,a.href),t=plain(m[2])||a.title||"";
    if(!u||!t||seen.has(u)||!/(?:genre|genero|categoria|category)/i.test(u)) continue;
    seen.add(u); out.push({id:"sr-cat-"+slug(t),title:"Series Retro · "+t.slice(0,36),ref:categoryRef("S","series",u),genre:"series"});
    if(out.length>=24) break;
  }
  return out.slice(0,24);
}
export async function browse(ref,cursor) {
  const c=parseCategory(ref); if(!c) throw kino.error("not_found","Categoría desconocida.");
  const n=cursor?Math.max(1,parseInt(String(cursor),10)||1):1;
  const p=await listPage(c.source,c.kind,n,c.url);
  const result={items:p.items.slice(0,100)};
  if(p.items.length>=10) result.next=String(n+1);
  return result;
}
export async function search(query) {
  const q=String(query&&query.q||"").trim(); if(!q) return [];
  const enc=encodeURIComponent(q);
  const defs=[
    ["F","series",FR+"/buscar/?q="+enc],["F","movie",FR+"/buscar/?q="+enc],
    ["S","series",SR+"/?s="+enc],["S","movie",SR+"/?s="+enc]
  ];
  const lists=await Promise.all(defs.map(async d=>{
    const contentLink=d[0]==="F"
      ? (d[1]==="movie"
        ? /(?:href|data-href)\s*=\s*["'][^"']*\/ver-serie\//i
        : /(?:href|data-href)\s*=\s*["'][^"']*\/lista-series\//i)
      : /(?:href|data-href)\s*=\s*["'][^"']*\/(?:serie|movie)\//i;
    const h=await page(d[2],contentLink,d[0]==="F");
    const found=cards(h,d[0]==="F"?FR:SR,d[0],d[1]);
    log("busqueda",d[0],d[1],"resultados",found.length);
    return found;
  }));
  const terms=q.toLowerCase().split(/\s+/).filter(Boolean);
  return unique(lists.flat()).filter(x=>terms.every(t=>x.title.toLowerCase().includes(t))).slice(0,100);
}
function seriesInfo(html,base) {
  const h=/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html||"");
  const im=/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i.exec(html||"");
  const d=/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i.exec(html||"");
  return {title:h?plain(h[1]):"Serie",poster:im?abs(base,decode(im[1])):undefined,overview:d?plain(d[1]):undefined};
}
function episodeList(html,base,source,seriesUrl) {
  const out=[],seen=new Set(),re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const sourceHtml=String(html||""); let m,season=1;
  const marks=[...sourceHtml.matchAll(/(?:temporada|season)\s*(\d{1,2})/gi)];
  while((m=re.exec(sourceHtml))) {
    const a=attrs(m[1]),u=abs(base,a.href||a["data-href"]);
    if(!u||u.replace(/\/$/,"")===seriesUrl.replace(/\/$/,"")||seen.has(u)) continue;
    const title=plain(m[2])||a.title||a["aria-label"]||"";
    const path=(()=>{try{return new URL(u).pathname;}catch(_){return "";}})();
    const ctx=sourceHtml.slice(Math.max(0,m.index-240),Math.min(sourceHtml.length,re.lastIndex+100));
    const combo=title+" "+path+" "+ctx;
    const xmatch=/(?:^|[^\d])(\d{1,2})\s*[x×]\s*0*(\d{1,3})(?:[^\d]|$)/i.exec(combo);
    const smatch=/(?:s|temporada|season)\s*0*(\d{1,2})\s*(?:e|x|×)/i.exec(combo);
    const ematch=/(?:episodio|cap[ií]tulo|episode|ep\.?)[\s._#:-]*0*(\d{1,4})/i.exec(combo);
    const explicitPath=/(?:\/episodios?\/|\/capitulos?\/|\/episodes?\/)/i.test(path);
    if(!xmatch&&!ematch&&!explicitPath) continue;
    let number=1;
    if(xmatch) { season=Math.max(1,Number(xmatch[1])); number=Math.max(1,Number(xmatch[2])); }
    else if(ematch) number=Math.max(1,Number(ematch[1]));
    if(smatch) season=Math.max(1,Number(smatch[1]));
    else {
      const prior=marks.filter(x=>x.index<m.index);
      if(prior.length) season=Math.max(1,Number(prior[prior.length-1][1]));
    }
    seen.add(u);
    out.push({season,number,ref:source+"|ep|"+u,title:title.slice(0,180)||"Episodio "+number});
  }
  return out.sort((a,b)=>a.season-b.season||a.number-b.number);
}
export async function episodes(ref) {
  const p=parseItem(ref); if(!p||p.kind!=="series") throw kino.error("not_found","La referencia no corresponde a una serie.");
  const base=p.source==="F"?FR:SR;
  const episodeWait=p.source==="F"
    ? /(?:ver[-_/]?(?:episodio|capitulo)|episodios?|cap[ií]tulos?|temporada|season|\\d{1,2}x\\d{1,3})/i
    : /temporada|cap[ií]tulos|episodios|episode|<h1/i;
  const h=await page(p.url,episodeWait,p.source==="F");
  if(!h) throw kino.error("unavailable","No se pudo cargar la ficha de la serie.");
  return {series:seriesInfo(h,base),episodes:episodeList(h,base,p.source,p.url)};
}
export async function resolve(ref) {
  const p=parseItem(ref); if(!p||!p.url||!["movie","ep"].includes(p.kind))
    throw kino.error("not_found","Referencia de reproducción inválida.");
  if(!kino.browser||!kino.browser.capture) throw kino.error("unavailable","Esta versión de Kino no ofrece captura de medios.");
  const result=await kino.browser.capture(p.url,{timeoutMs:25000,match:"\.m3u8|\.mpd|\.mp4"});
  const media=result&&Array.isArray(result.media)?result.media:[];
  if(!media.length) throw kino.error("unavailable","No se detectó un archivo de video compatible y accesible.");
  return {url:media[0].url,headers:media[0].headers,mime:media[0].mime,
    alternatives:media.slice(1,5).map((x,i)=>({url:x.url,headers:x.headers,mime:x.mime,label:"Opción "+(i+2)})),
    subtitles:(result.subtitles||[]).map(s=>({url:s.url,lang:s.lang||"es"}))};
}
