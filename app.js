/* ==========================================================================
   bo-rro !（borro） ─ 共通スクリプト（do-ya? 型）
   --------------------------------------------------------------------------
   各ページは data.js → app.js の順に読み込む。
   ページ固有の内容は、それぞれのHTMLに直接書く（ページ単位で編集できる）。
   ========================================================================== */

const WD = { mon:"月", tue:"火", wed:"水", thu:"木", fri:"金", sat:"土", sun:"日" };
const KEYS = ["sun","mon","tue","wed","thu","fri","sat"];
const todayKey = () => KEYS[new Date().getDay()];
const isOpenToday = (s) => !(s.closed || []).includes(todayKey());
const shopsIn = (cat) => SHOPS.filter(s => s.cats.includes(cat));
const findShop = (slug) => SHOPS.find(s => s.slug === slug);
const catById = (id) => CATEGORIES.find(c => c.id === id);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, m =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));

/* ==========================================================================
   0.（削除済み）旧背景 .bgwrap
   --------------------------------------------------------------------------
   存在しない img/bg.webp を参照していた旧実装。
   現在の背景は「3. 背景イラスト」の .bgart が担当している。
   ========================================================================== */

/* ==========================================================================
   1. ページ遷移（白飛びさせない）
   ========================================================================== */
(function () {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("entering");
  requestAnimationFrame(() => requestAnimationFrame(() =>
    document.documentElement.classList.remove("entering")));
  if (reduced) return;

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("tel:") ||
        href.startsWith("mailto:") || a.target === "_blank" ||
        a.hasAttribute("data-nt") || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (new URL(href, location.href).origin !== location.origin) return;
    e.preventDefault();
    document.documentElement.classList.add("leaving");
    setTimeout(() => { location.href = href; }, 240);
  });

  addEventListener("pageshow", (e) => {
    if (e.persisted) document.documentElement.classList.remove("leaving", "entering");
  });
})();

/* ==========================================================================
   2. 計測（data-track を1箇所で拾う）
   ========================================================================== */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-track]");
  if (!el) return;
  console.debug("[track]", {
    event: el.dataset.track,
    shop_slug: el.dataset.shop || null,
    category: document.body.dataset.cat || null,
  });
});

/* ==========================================================================
   3. 背景イラスト（全ページ共通で最初に差し込む）
   ========================================================================== */
(function mountBg() {
  if (document.body.classList.contains("no-bgart")) return;
  if (document.querySelector(".bgart")) return;

  const d = document.createElement("div");
  d.className = "bgart";
  d.setAttribute("aria-hidden", "true");
  /* 縦のゆらぎ用の内側レイヤー（fixed に transform をかけないため） */
  const sway = document.createElement("div");
  sway.className = "bgart-sway";
  d.appendChild(sway);

  /* ゆらぎの位相をずらす。毎回きっちり同じ動きにしない */
  sway.style.setProperty("--bg-delay", (-Math.random() * 10).toFixed(2) + "s");

  /* 開くたびに、絵の違う場所から始める。
     絵1枚は2439px。そのどこかから始める。 */
  sway.style.setProperty("--bg-start", -Math.floor(Math.random() * 2439) + "px");

  document.body.prepend(d);

  /* webp が読めない環境の保険 */
  const t = new Image();
  t.onerror = () => document.documentElement.classList.add("no-webp");
  t.src = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
})();

/* ==========================================================================
   4. ヘッダー ＋ 全画面メニュー
   ========================================================================== */
const SUBPAGES = [
  { en:"SHOP",     ja:"お店を教える",     href:"entry.html" },
  { en:"CONTACT",  ja:"まちがいを教える", href:"contact.html" },
  { en:"ABOUT",    ja:"このサイトについて", href:"about.html" },
];

function mountHeader(catId) {
  const cat = catId ? catById(catId) : null;
  const host = document.getElementById("hd");
  if (!host) return;

  host.innerHTML = `
<header class="hd">
  <a class="hd-logo" href="index.html">
    <b>bo-rro !</b><span>ぼーろ</span>
  </a>
  <p class="hd-tag">枕崎のぜんぶを、<br>ひとつの場所に。</p>
  ${cat ? `<span class="hd-now">${cat.label}</span>` : ""}
  <button class="hd-menu pop" id="menu-open" type="button" aria-label="メニューを開く">
    <span class="hd-menu-bars" aria-hidden="true"><i></i><i></i><i></i></span>
    <span>MENU</span>
  </button>
</header>

<div class="nav" id="nav" role="dialog" aria-modal="true" aria-label="メニュー">
  <button class="nav-close" id="menu-close" type="button">CLOSE ✕</button>
  <div class="nav-in wrap">
    <p class="nav-lead">どこを見る？</p>
    <div class="nav-grid">
      ${CATEGORIES.map(c => `
        <a class="nav-card" href="${c.id}.html" style="--c:${c.color}">
          <span><b>${c.label}</b><br><small>${c.note}</small></span>
          <i aria-hidden="true">→</i>
        </a>`).join("")}
    </div>
    <div class="nav-sub">
      ${SUBPAGES.map(p => `<a href="${p.href}"><em>${p.en}</em><span>${p.ja}</span></a>`).join("")}
    </div>
  </div>
</div>`;

  const nav = document.getElementById("nav");
  const open = () => { nav.classList.add("on"); document.body.style.overflow = "hidden"; };
  const close = () => { nav.classList.remove("on"); document.body.style.overflow = ""; };
  document.getElementById("menu-open").addEventListener("click", open);
  document.getElementById("menu-close").addEventListener("click", close);
  addEventListener("keydown", e => { if (e.key === "Escape") close(); });
}

/* ==========================================================================
   5. フッタ
   ========================================================================== */
function mountFooter() {
  const host = document.getElementById("ft");
  if (!host) return;
  host.innerHTML = `
<footer class="ft">
  <div class="wrap">
    <p class="ft-logo">bo-rro !</p>
    <p class="ft-sub">BORRO ／ 枕崎市網羅型ポータルサイト</p>
    <nav class="ft-nav">
      ${CATEGORIES.map(c => `<a href="${c.id}.html"><em>${c.id.toUpperCase()}</em><span>${c.label}</span></a>`).join("")}
      ${SUBPAGES.map(p => `<a href="${p.href}"><em>${p.en}</em><span>${p.ja}</span></a>`).join("")}
    </nav>
    <p class="ft-note">
      このサイトは枕崎市の公式サイトではありません。<br>
      掲載内容は調査時点のものです。最新の情報は各店舗・各機関でご確認ください。
    </p>
    <p class="ft-copy">© borro</p>
  </div>
</footer>
<button class="pagetop" id="pagetop" type="button" aria-label="いちばん上にもどる">↑</button>`;

  /* ★右下の固定バッジ。do-ya? のトゲトゲの「？」と同じ位置・同じ性格。
     少し下げてから出す＝最初の画面では邪魔をしない */
  const top = document.getElementById("pagetop");
  const onScroll = () => top.classList.toggle("on", scrollY > 600);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  top.addEventListener("click", () => scrollTo({
    top: 0,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  }));
}

/* ==========================================================================
   6. 店舗カード
   ========================================================================== */
function cardHTML(s) {
  const open = isOpenToday(s);
  const closedText = (s.closed && s.closed.length)
    ? s.closed.map(d => WD[d]).join("・") + "休" : "無休";
  return `
<article class="card">
  <a class="card-hit" href="shop.html?s=${s.slug}" data-track="page_view" data-shop="${s.slug}">
    <div class="card-head">
      <span class="tag">${esc(s.subLabel)}</span>
      <span class="state ${open ? "open" : "closed"}">${open ? "今日は営業日" : "今日は定休日"}</span>
    </div>
    <h3 class="card-name">${esc(s.name)}</h3>
    ${s.lead ? `<p class="card-lead">${esc(s.lead)}</p>` : ""}
    ${s.charge ? `<p class="card-charge">${esc(s.charge)}</p>` : ""}
    ${s.sig ? `<p class="card-sig"><b>${esc(s.sig.item)}</b>${s.sig.price ? `<span>${esc(s.sig.price)}</span>` : ""}</p>` : ""}
    <dl class="card-meta">
      <div><dt>場所</dt><dd>${esc(s.address)}</dd></div>
      ${s.hours ? `<div><dt>時間</dt><dd class="num">${esc(s.hours)}</dd></div>` : ""}
      <div><dt>休み</dt><dd>${closedText}${s.irregular ? `<span class="irr">＋不定休</span>` : ""}</dd></div>
    </dl>
  </a>
  ${s.tel ? `<a class="card-tel" href="tel:${s.tel.replace(/-/g,"")}"
     data-track="tap_tel" data-shop="${s.slug}"><span aria-hidden="true">☎</span><span class="num">${esc(s.tel)}</span></a>` : ""}
</article>`;
}

/* ==========================================================================
   7. ★横スライドのセクションを作る
   　　slideSection({ el, en, ja, shops, more })
   ========================================================================== */
function slideSection({ en, ja, shops, more, moreHref }) {
  if (!shops.length) return "";
  return `
  <div class="wrap sec-hd">
    <h2 class="sec-en">${esc(en)}</h2>
    <p class="sec-ja">${esc(ja)}</p>
    ${more ? `<a class="sec-more" href="${moreHref}">${esc(more)}</a>` : ""}
  </div>
  <div class="wrap"><p class="slide-hint">よこにスクロール</p></div>
  <div class="slide">
    ${shops.map(cardHTML).join("")}
    ${more ? `<a class="slide-end" href="${moreHref}">${esc(more)}</a>` : ""}
  </div>`;
}

/* ==========================================================================
   8. カテゴリページ ─ 中分類ごとに横スライドで積む
   ========================================================================== */
function buildCategory(catId, opts = {}) {
  const cat = catById(catId);
  const shops = shopsIn(catId);
  const openNow = shops.filter(isOpenToday);
  const irr = shops.filter(s => s.irregular).length;

  mountHeader(catId);
  mountFooter();

  /* --- ヒーロー（このカテゴリの「顔」）--- */
  const heroEl = document.getElementById("hero");
  if (heroEl && !heroEl.dataset.custom) {
    heroEl.innerHTML = `
<section class="hero">
  <div class="wrap">
    <p class="hero-en">${catId.toUpperCase()}</p>
    <h1 class="hero-h">${esc(opts.headline || cat.label)}</h1>
    ${opts.lead ? `<p class="hero-lead">${esc(opts.lead)}</p>` : ""}
    <div class="hero-stat">
      <span class="hero-num">${openNow.length}</span>
      <span class="hero-unit">軒が今日の営業日</span>
      <span class="hero-of">／ 掲載 ${shops.length} 軒</span>
    </div>
    ${irr ? `<p class="hero-caveat">定休日をもとにした目安です。${irr}軒は臨時休業もあるため、行く前に確認を。</p>` : ""}
  </div>
</section>`;
  }

  /* --- 中分類ごとの横スライド --- */
  const groups = [];
  const map = new Map();
  shops.forEach(s => {
    if (map.has(s.sub)) map.get(s.sub).list.push(s);
    else { const g = { key:s.sub, label:s.subLabel, list:[s] }; map.set(s.sub, g); groups.push(g); }
  });
  groups.sort((a,b) => b.list.length - a.list.length);

  const LABEL_EN = {
    katsuo:"KATSUO", kaisen:"SEAFOOD", shokudo:"SHOKUDO", ramen:"NOODLE",
    chuka:"CHINESE", sushi:"SUSHI", washoku:"JAPANESE", yakiniku:"YAKINIKU",
    kushiage:"KUSHIAGE", bento:"BENTO", cafe:"CAFE", bakery:"BAKERY", sweets:"SWEETS",
    bar:"BAR", snack:"SNACK", izakaya:"IZAKAYA", amusement:"AMUSEMENT",
    karaoke_snack:"KARAOKE SNACK", karaoke_bar:"KARAOKE BAR", karaoke_box:"KARAOKE BOX",
  };
  const LABEL_JA = {
    katsuo:"枕崎といえば、これ", kaisen:"港の近くで", shokudo:"毎日でも食べられる",
    ramen:"麺が食べたい日に", chuka:"中華もある", sushi:"寿司はここ",
    washoku:"人をもてなす日に", yakiniku:"肉を焼く", kushiage:"揚げたてを",
    bento:"持ち帰って食べる", cafe:"ひと息つく", bakery:"朝から開いてる",
    sweets:"手土産にも", bar:"静かに飲むなら", snack:"ママがいる店",
    izakaya:"わいわい飲む", amusement:"遊びながら飲む",
    karaoke_snack:"歌って飲む", karaoke_bar:"飲んで歌う", karaoke_box:"部屋で歌う",
  };

  /* ★帯の色を循環させる。白 → 色 → 白 → 色…と挟むことで疲れさせない
     （do-ya? も色帯の合間に白を入れて休ませている） */
  /* "" は背景イラストが透ける区間。色帯と交互に置いてリズムを作る */
  /* do-ya? の帯は 黄 → 桃 → 空 → 黒 の4色。間に白（""）を挟んで休ませる */
  const BANDS = ["", "sun", "", "coral", "", "sky", "", "dark"];
  const parts = groups.map((g, i) => `
<section class="sec ${BANDS[i % BANDS.length]}">
  ${slideSection({
    en: LABEL_EN[g.key] || g.label,
    ja: LABEL_JA[g.key] || `${g.label}（${g.list.length}軒）`,
    shops: g.list,
  })}
</section>`);

  /* ★中盤に、背景イラストだけを見せる余白を挟む。
     「余白が多くても気にならない」ではなく「余白で背景を見せる」ための仕掛け */
  if (parts.length >= 4) {
    parts.splice(Math.ceil(parts.length / 2), 0,
      `<section class="sec air" aria-hidden="true"></section>`);
  }
  const secs = parts.join("");

  /* --- 全件一覧（探しに来た人向け。ここだけグリッド）--- */
  const all = `
<section class="sec paper" id="all">
  <div class="wrap sec-hd">
    <h2 class="sec-en">ALL</h2>
    <p class="sec-ja">ぜんぶ見る（${shops.length}軒）</p>
  </div>
  <div class="wrap tools">
    <div class="chips" role="group" aria-label="種類でしぼる">
      <button class="chip on" data-sub="all" type="button">すべて<span class="chip-n">${shops.length}</span></button>
      ${groups.map(g => `<button class="chip" data-sub="${g.key}" type="button">${esc(g.label)}<span class="chip-n">${g.list.length}</span></button>`).join("")}
    </div>
    <label class="toggle">
      <input type="checkbox" id="openonly">
      <span class="toggle-box" aria-hidden="true"></span>
      <span>今日の営業日だけ</span>
    </label>
  </div>
  <p class="count wrap" id="count" aria-live="polite"></p>
  <div class="grid wrap" id="list">
    ${shops.map(s => `<div class="cell" data-sub="${s.sub}" data-open="${isOpenToday(s)?1:0}">${cardHTML(s)}</div>`).join("")}
  </div>
  <p class="empty wrap" id="empty" hidden>
    条件に合うお店がありません。<button class="chip" id="reset" type="button">条件をもどす</button>
  </p>
</section>

<section class="sec tint">
  <div class="wrap ask">
    <p class="sticker">まだ途中です</p>
    <h2>載っていないお店があります</h2>
    <p>枕崎の${cat.label}は、まだ全部載せきれていません。<br>
       知っているお店を教えてください。掲載は無料です。</p>
    <a class="btn" href="entry.html"><span class="btn-en">Entry</span>お店を教える</a>
  </div>
</section>`;

  document.getElementById("app").innerHTML = secs + all;
  wireFilter();
}

/* --- 絞り込み（飾りではなく実際に動く）--------------------------------- */
function wireFilter() {
  const cells = [...document.querySelectorAll(".cell")];
  const chips = [...document.querySelectorAll(".chip[data-sub]")];
  const only = document.getElementById("openonly");
  const countEl = document.getElementById("count");
  const emptyEl = document.getElementById("empty");
  if (!cells.length || !only) return;
  let sub = "all";

  function apply() {
    let n = 0;
    cells.forEach(c => {
      const ok = (sub === "all" || c.dataset.sub === sub) &&
                 (!only.checked || c.dataset.open === "1");
      c.hidden = !ok;
      if (ok) n++;
    });
    countEl.textContent = `${n} 軒を表示中`;
    emptyEl.hidden = n > 0;
  }
  chips.forEach(c => c.addEventListener("click", () => {
    chips.forEach(x => x.classList.toggle("on", x === c));
    sub = c.dataset.sub; apply();
  }));
  only.addEventListener("change", apply);
  document.getElementById("reset")?.addEventListener("click", () => {
    sub = "all"; only.checked = false;
    chips.forEach(x => x.classList.toggle("on", x.dataset.sub === "all"));
    apply();
  });
  apply();
}

/* ==========================================================================
   9. 準備中ページ
   ========================================================================== */
/* ページの一部として差し込みたいときは、差し込み先のIDを渡す。
   life.html のように「本実装が始まったページ」で、残りだけ準備中にする用。 */
function buildSoonInto(catId, hostId) { buildSoon(catId, hostId); }

function buildSoon(catId, hostId) {
  const cat = catById(catId);
  const d = SOON[catId] || { collected:0, plans:[] };
  const ready = CATEGORIES.filter(c => c.ready);

  mountHeader(catId);
  mountFooter();

  const host = document.getElementById(hostId || "app");

  /* 差し込みモード（hostId 指定あり）のときは、ヒーローを二重に出さない */
  const heroHtml = hostId ? "" : `
<section class="hero">
  <div class="wrap">
    <p class="hero-en">${catId.toUpperCase()}</p>
    <h1 class="hero-h">${cat.label}は、<br>いま作っています</h1>
    <p class="hero-lead">調べたお店は ${d.collected} 軒。<br>
      ひとつずつ確認をとってから載せるので、もう少しかかります。</p>
  </div>
</section>`;

  host.innerHTML = heroHtml + `
<section class="sec">
  <div class="wrap soon-box">
    <p class="sec-en" style="font-size:var(--t-md)">COMING SOON</p>
    <ul class="plans">${d.plans.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
    <div style="margin-top:var(--s-8)">
      <a class="btn" style="margin-top:0" href="entry.html"><span class="btn-en">Entry</span>お店を教える</a>
      <p style="margin-top:var(--s-3);font-size:var(--t-xs);color:var(--ink-mid)">
        載せてほしいお店、載ってほしくないお店、どちらも教えてください。</p>
    </div>
  </div>
</section>

<section class="sec tint">
  <div class="wrap sec-hd">
    <h2 class="sec-en">OPEN NOW</h2>
    <p class="sec-ja">先に見られるのはこちら</p>
  </div>
  <div class="wrap" style="margin-top:var(--s-6);display:grid;gap:var(--s-3);
    grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
    ${ready.map(c => `<a href="${c.id}.html" style="--c:${c.color};display:flex;align-items:center;
      gap:var(--s-3);padding:var(--s-5);border-radius:var(--r-card);border:var(--line) solid #000;background:#fff">
      <span><b style="font-family:var(--font-display);font-size:var(--t-md);color:#000">${c.label}</b><br>
      <small style="font-size:var(--t-xs);color:var(--ink-mid)">${c.note}</small></span>
      <span style="margin-left:auto;color:#000">→</span></a>`).join("")}
  </div>
</section>`;
}

/* ==========================================================================
   10. 店舗ページ（shop.html?s=slug）
   ========================================================================== */
function buildShop() {
  const slug = new URLSearchParams(location.search).get("s");
  const s = findShop(slug);
  const app = document.getElementById("app");

  if (!s) {
    mountHeader(null); mountFooter();
    app.innerHTML = `<section class="sec"><div class="wrap" style="text-align:center">
      <h1>お店が見つかりません</h1>
      <p style="margin-top:var(--s-4);color:var(--ink-mid)">URLが違うか、掲載を取りやめた可能性があります。</p>
      <a class="btn" href="index.html">はじめから見る</a></div></section>`;
    return;
  }

  document.body.dataset.cat = s.primary;
  document.title = `${s.name} ─ bo-rro !［枕崎市網羅型ポータルサイト］`;
  mountHeader(s.primary); mountFooter();

  const cat = catById(s.primary);
  const open = isOpenToday(s);
  const closedText = (s.closed && s.closed.length) ? s.closed.map(d => WD[d]).join("・") : "なし";
  const mq = encodeURIComponent(`枕崎市${s.address} ${s.name}`);
  const nb = s.building ? SHOPS.filter(x => x.building === s.building && x.slug !== s.slug) : [];
  const act = (cls, href, ico, txt, sub, track, blank) => `
    <a class="act ${cls}" href="${href}" ${blank ? 'target="_blank" rel="noopener"' : ""}
       data-track="${track}" data-shop="${s.slug}">
      <span class="act-ico" aria-hidden="true">${ico}</span>
      <span class="act-txt">${txt}<span class="act-sub">${sub}</span></span></a>`;
  const note = (k, v) => v ? `<div class="note"><p class="note-key">${k}</p><p class="note-val">${esc(v)}</p></div>` : "";

  app.innerHTML = `
<section class="sec paper">
  <div class="wrap">
    <nav class="crumb"><a href="${s.primary}.html">${cat.label}</a>
      <span aria-hidden="true">›</span><span>${esc(s.subLabel)}</span></nav>

    <header style="margin-top:var(--s-6)">
      <p class="sec-en" style="font-size:var(--t-sm)">${esc(s.subLabel)}</p>
      <h1 style="margin-top:var(--s-2);font-size:clamp(1.9rem,7vw,var(--t-xl))">${esc(s.name)}</h1>
      <p style="margin-top:var(--s-1);font-size:var(--t-xs);color:var(--ink-faint);letter-spacing:.1em">${esc(s.kana)}</p>
      ${s.lead ? `<p style="margin-top:var(--s-4);font-size:var(--t-md);line-height:1.95;color:var(--ink-mid);max-width:40em">${esc(s.lead)}</p>` : ""}
      ${s.cats.length > 1 ? `<p class="also">このお店は ${s.cats.map(c => {
        const x = catById(c);
        return `<a class="also-link" href="${c}.html" style="--c:${x.color}">${x.label}</a>`;
      }).join(" ")} に載っています</p>` : ""}
    </header>

    ${s.charge ? `<section class="charge">
      <p class="charge-label">料金</p><p class="charge-val">${esc(s.charge)}</p>
      <p class="charge-note">掲載時点の情報です。お店で確認してください。</p></section>` : ""}

    ${s.sig ? `<section class="sig">
      <p class="sig-label">名物</p><p class="sig-item">${esc(s.sig.item)}</p>
      ${s.sig.price ? `<p class="sig-price">${esc(s.sig.price)}</p>` : ""}</section>` : ""}

    ${s.irregular ? `<p class="warn"><span class="warn-mark" aria-hidden="true">!</span>
      この店は定休日以外にも休むことがあります。行く前に確認してください。</p>` : ""}

    <section class="facts">
      <div class="fact"><p class="fact-key">きょう</p>
        <p class="fact-val ${open ? "ok" : "ng"}">${open ? "営業日です" : "定休日です"}</p></div>
      <div class="fact"><p class="fact-key">営業時間</p>
        <p class="fact-val num">${esc(s.hours || "確認中")}</p></div>
      <div class="fact"><p class="fact-key">定休日</p><p class="fact-val">${closedText}</p></div>
      <div class="fact"><p class="fact-key">住所</p><p class="fact-val">枕崎市${esc(s.address)}</p></div>
    </section>

    ${(s.reservation||s.payment||s.delivery||s.dietary||s.parking) ? `<section class="notes">
      ${note("予約",s.reservation)}${note("支払い",s.payment)}${note("配達",s.delivery)}
      ${note("食事制限",s.dietary)}${note("駐車場",s.parking)}</section>` : ""}

    <section class="acts">
      ${s.tel ? act("act-primary", `tel:${s.tel.replace(/-/g,"")}`, "☎", "電話する", `<span class="num">${esc(s.tel)}</span>`, "tap_tel") : ""}
      ${act("", `https://www.google.com/maps/search/?api=1&query=${mq}`, "◎", "地図で見る", "ルート案内", "tap_map", true)}
      ${s.ig ? act("", `https://instagram.com/${s.ig}`, "◍", "Instagram", `@${esc(s.ig)}`, "tap_instagram", true) : ""}
      ${s.x ? act("", `https://x.com/${s.x}`, "✕", "X（旧Twitter）", `@${esc(s.x)}`, "tap_x", true) : ""}
    </section>

    ${nb.length ? `<section style="margin-top:var(--s-12)">
      <p class="sec-en" style="font-size:var(--t-md)">SAME BUILDING</p>
      <p class="sec-ja">同じ建物に、あと${nb.length}軒 ─ ${esc(s.building)}</p>
      <div class="nb-grid">${nb.map(n => `<a class="nb-card" href="shop.html?s=${n.slug}">
        <span class="nb-name">${esc(n.name)}</span><span class="nb-sub">${esc(n.subLabel)}</span>
        ${n.charge ? `<span class="nb-charge">${esc(n.charge)}</span>` : ""}</a>`).join("")}</div>
    </section>` : ""}

    ${s.operator ? `<p style="margin-top:var(--s-6);font-size:var(--t-xs);color:var(--ink-mid)">
      同じ方が「${esc(s.operator)}」を営んでいます。</p>` : ""}

    <section class="fix"><p>情報が違っていたら教えてください。すぐ直します。
      <a href="contact.html">まちがいを教える</a></p></section>
  </div>
</section>`;
}

/* ==========================================================================
   11. ポップアップ（サイトを離れずに、外部の中身を読む）
   --------------------------------------------------------------------------
   ★使いどころの原則（2026/8/29に実機で確かめた結論）

     「公式に埋め込み用のURLを配っているものだけ」を入れる。
     それ以外は賭けになる。しかも**成否は事前にも事後にも判定できない。**
     X-Frame-Options で拒否されたとき、ブラウザは成功と同じ load を出し、
     中身も別ドメイン扱いになるため、JavaScript から区別がつかない。

   | 対象                        | 可否 | 備考                                   |
   |-----------------------------|------|----------------------------------------|
   | Instagram の投稿1件         | ○    | instagram.com/p/{code}/embed/          |
   | X（旧Twitter）の投稿1件     | ○    | 公式の埋め込みあり                     |
   | YouTube                     | ○    | 公式の埋め込みあり                     |
   | Google マップ               | ○    | 公式の埋め込みあり                     |
   | **枕崎市の公式サイト**      | **×**| **拒否される。2026/8/29 実機で確認済み** |
   | Instagram のプロフィール    | ×    | 埋め込み用URLが存在しない              |
   | 食べログ・EPARK 等          | ほぼ×| 大半が拒否                             |
   | お店の自前サイト            | 賭け | そもそも shop.html があるので不要      |

   ★行政関連は、すべて別タブで開くこと。ポップアップに入れない。

   使い方
     openPop({ url, title, source })
     または <a href="..." data-pop data-source="..."> にしておくと自動で開く
   ========================================================================== */
function openPop(opt) {
  const url    = opt.url;
  const title  = opt.title  || "";
  const source = opt.source || (() => { try { return new URL(url).hostname; } catch (e) { return ""; } })();

  let pop = document.getElementById("pop");
  if (!pop) {
    pop = document.createElement("div");
    pop.className = "pop";
    pop.id = "pop";
    pop.innerHTML = `
<div class="pop-back" data-close></div>
<div class="pop-panel" role="dialog" aria-modal="true" aria-labelledby="popTitle">
  <div class="pop-bar">
    <div class="pop-head">
      <p class="pop-title" id="popTitle"></p>
      <p class="pop-src"><b></b><span></span></p>
    </div>
    <button class="pop-x" type="button" data-close aria-label="閉じる">
      <span aria-hidden="true">✕</span><span class="pop-x-t">とじる</span>
    </button>
  </div>
  <div class="pop-body">
    <div class="pop-load">読み込んでいます…</div>
    <iframe class="pop-frame" title="外部の内容" referrerpolicy="no-referrer"
            allow="encrypted-media; picture-in-picture" loading="lazy"></iframe>
  </div>
  <div class="pop-foot">
    <p class="pop-hint">白いまま表示されないときは、こちらから開いてください</p>
    <a class="pop-open" target="_blank" rel="noopener">
      <span class="btn-en">Open</span>もとのページを開く ↗
    </a>
  </div>
</div>`;
    document.body.appendChild(pop);

    pop.addEventListener("click", e => { if (e.target.closest("[data-close]")) closePop(); });
    addEventListener("keydown", e => { if (e.key === "Escape") closePop(); });
  }

  const frame = pop.querySelector(".pop-frame");
  const load  = pop.querySelector(".pop-load");

  pop.querySelector(".pop-title").textContent   = title;
  pop.querySelector(".pop-src b").textContent   = opt.label || "外部サイト";
  pop.querySelector(".pop-src span").textContent = source;
  pop.querySelector(".pop-open").href           = opt.href || url;

  load.hidden = false;
  frame.style.visibility = "hidden";
  frame.src = url;

  const reveal = () => { load.hidden = true; frame.style.visibility = "visible"; };
  clearTimeout(openPop._t);
  openPop._t = setTimeout(reveal, 2500);
  frame.onload = () => setTimeout(reveal, 200);

  openPop._back = document.activeElement;
  pop.classList.add("on");
  document.body.classList.add("pop-lock");
  pop.querySelector(".pop-x").focus();
}

function closePop() {
  const pop = document.getElementById("pop");
  if (!pop || !pop.classList.contains("on")) return;
  clearTimeout(openPop._t);
  pop.classList.remove("on");
  pop.querySelector(".pop-frame").src = "about:blank";
  document.body.classList.remove("pop-lock");
  if (openPop._back) openPop._back.focus();
}

/* Instagram の投稿を開く。code は URL の /p/XXXX/ の部分 */
function openInstagram(code, title) {
  openPop({
    url: `https://www.instagram.com/p/${code}/embed/`,
    href: `https://www.instagram.com/p/${code}/`,
    title: title || "Instagramの投稿",
    label: "Instagram",
    source: "instagram.com",
  });
}

/* data-pop の付いたリンクは、自動でポップアップで開く */
document.addEventListener("click", e => {
  const a = e.target.closest("a[data-pop]");
  if (!a) return;
  e.preventDefault();
  openPop({
    url: a.dataset.embed || a.getAttribute("href"),
    href: a.getAttribute("href"),
    title: a.dataset.name || a.textContent.trim(),
    label: a.dataset.label,
  });
});

/* ==========================================================================
   12. Instagram の投稿を横スライドで並べる
   --------------------------------------------------------------------------
   ★D-12（Instagram宣伝枠）の見え方をここで決める。

   埋め込めるのは **投稿1件（/p/コード/ または /reel/コード/）だけ**。
   リールは post に "reel/コード" と書く。通常の投稿はコードだけでよい。
   プロフィールページには公式の埋め込み用URLが無いので埋め込めない。
     → 投稿コードが無いアカウントは、プロフィールへ飛ぶカードとして出す。

   ★重さ対策：画面に入るまで iframe を読み込まない。
     Instagram の埋め込みは Meta のスクリプトを読むため、
     4枚まとめて読むとページが目に見えて重くなる。

   ★プライバシー：埋め込みを本番で使う前に privacy.html が要る。
     訪問者の情報が Meta に渡るため、明記が必要。
   ========================================================================== */
function buildInstaRail(hostId, opts) {
  const host = document.getElementById(hostId);
  if (!host || !opts || !opts.accounts || !opts.accounts.length) return;

  const cards = opts.accounts.map(a => {
    /* post は "DccGBDdTAIT"（通常の投稿）でも
       "reel/DcnX2Uux5VO"（リール）でも受け取れるようにする */
    const code = a.post || "";
    const path = code ? (code.indexOf("/") >= 0 ? code : "p/" + code) : "";
    const prof = `https://www.instagram.com/${a.handle}/`;
    return `
<article class="ig-card">
  <a class="ig-head" href="${prof}" target="_blank" rel="noopener">
    <span class="ig-mark" aria-hidden="true"></span>
    <span class="ig-who">
      <b>${esc(a.name)}</b>
      <small>@${esc(a.handle)}</small>
    </span>
    <span class="ig-go" aria-hidden="true">↗</span>
  </a>
  <div class="ig-body">
    ${code
      ? `<div class="ig-slot" data-src="https://www.instagram.com/${path}/embed/">
           <span class="ig-wait">読み込んでいます…</span>
         </div>`
      : `<a class="ig-empty" href="${prof}" target="_blank" rel="noopener">
           <b>投稿はInstagramで</b>
           <span>@${esc(a.handle)} を開く</span>
         </a>`}
  </div>
</article>`;
  }).join("");

  host.innerHTML = `
<section class="sec ig-sec">
  <div class="wrap">
    <div class="sec-hd">
      <p class="sec-ja">${esc(opts.ja || "お店からの、いちばん新しい話")}</p>
      <h2 class="sec-en">${esc(opts.en || "Instagram")}</h2>
    </div>
    <p class="slide-hint">よこにスクロール　→</p>
  </div>
  <div class="slide ig-rail">${cards}</div>
  <div class="wrap"><p class="ig-note">投稿はお店のInstagramのものです。営業日や臨時休業は、お店の投稿が最新です。</p></div>
</section>`;

  /* 画面に入ったものだけ読み込む */
  const slots = host.querySelectorAll(".ig-slot");
  if (!slots.length) return;

  const load = slot => {
    if (slot.dataset.on) return;
    slot.dataset.on = "1";
    const f = document.createElement("iframe");
    f.src = slot.dataset.src;
    f.loading = "lazy";
    f.title = "Instagramの投稿";
    f.setAttribute("scrolling", "no");
    f.setAttribute("referrerpolicy", "no-referrer");
    f.addEventListener("load", () => slot.classList.add("ready"));
    slot.appendChild(f);
  };

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es, o) => {
      es.forEach(e => { if (e.isIntersecting) { load(e.target); o.unobserve(e.target); } });
    }, { rootMargin: "200px" });
    slots.forEach(s => io.observe(s));
  } else {
    slots.forEach(load);
  }
}
