/* ==========================================================================
   bo-rro !（borro） ─ 暮らしページ専用のスクリプト
   --------------------------------------------------------------------------
   このページだけで使うものはここに置く。app.js は全ページ共通のまま保つ。

   1. 今日のごみ（校区別）
   2. 給付・助成・手当の一覧
   3. 市のお金（サンキー図）

   ★数字・日付はいずれも市の公表値をそのまま使い、加工していない。
   ========================================================================== */

buildSoonInto("life", "app");

/* ==========================================================================
   1. 今日のごみ
   --------------------------------------------------------------------------
   出典：枕崎市「ごみの収集日」市民生活課 環境整備係（2025年7月1日更新）

   曜日の数字は 0=日 1=月 2=火 3=水 4=木 5=金 6=土
   もえないごみは「第n○曜日」なので、日付から第何週かを計算する。
   ========================================================================== */
(function () {
  const AREAS = [
    { id: "makurazaki",  name: "枕崎",      full: "枕崎校区",
      burn: [1, 5], nonburn: { w: 3, n: 1 }, recycle: [2],
      say: { burn: "月曜・金曜", nonburn: "第1水曜", recycle: "火曜" } },
    { id: "beppu",       name: "別府",      full: "別府校区",
      burn: [1, 5], nonburn: { w: 3, n: 2 }, recycle: [2],
      say: { burn: "月曜・金曜", nonburn: "第2水曜", recycle: "火曜" } },
    { id: "sakurayama",  name: "桜山・金山", full: "桜山・金山校区",
      burn: [3, 6], nonburn: { w: 5, n: 3 }, recycle: [4],
      say: { burn: "水曜・土曜", nonburn: "第3金曜", recycle: "木曜" } },
    { id: "tategami",    name: "立神",      full: "立神校区",
      burn: [3, 6], nonburn: { w: 5, n: 4 }, recycle: [4],
      say: { burn: "水曜・土曜", nonburn: "第4金曜", recycle: "木曜" } },
  ];

  /* ★色は枕崎市の指定ごみ袋に合わせている（緑・赤・黄） */
  const KIND = {
    burn:    { label: "もえるごみ",   short: "もえる",   cls: "k-burn", bag: "b-burn", t: "t-burn", bagName: "緑の袋" },
    nonburn: { label: "もえないごみ", short: "もえない", cls: "k-non",  bag: "b-non",  t: "t-non",  bagName: "赤の袋" },
    recycle: { label: "資源ごみ",     short: "資源",     cls: "k-rec",  bag: "b-rec",  t: "t-rec",  bagName: "黄の袋" },
  };
  const WD = ["日", "月", "火", "水", "木", "金", "土"];

  const pick  = document.getElementById("gomiPick");
  const out   = document.getElementById("gomiOut");
  const today = document.getElementById("gomiToday");
  const week  = document.getElementById("gomiWeek");
  if (!pick) return;

  /* その月の第何週目の曜日か（1日〜7日が第1、8〜14日が第2…） */
  const nth = d => Math.floor((d.getDate() - 1) / 7) + 1;

  /* その日に出せるごみ */
  const on = (area, d) => {
    const w = d.getDay(), r = [];
    if (area.burn.includes(w)) r.push("burn");
    if (w === area.nonburn.w && nth(d) === area.nonburn.n) r.push("nonburn");
    if (area.recycle.includes(w)) r.push("recycle");
    return r;
  };

  const addDays = (d, n) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    return x;
  };

  /* --- 校区のボタンを作る --- */
  AREAS.forEach(a => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gomi-btn";
    b.dataset.id = a.id;
    b.innerHTML = `<b>${a.name}</b><span>校区</span>`;
    b.addEventListener("click", () => choose(a.id));
    pick.appendChild(b);
  });

  function choose(id) {
    const area = AREAS.find(a => a.id === id);
    if (!area) return;

    pick.querySelectorAll(".gomi-btn").forEach(b =>
      b.classList.toggle("on", b.dataset.id === id));

    /* 次に来たときも同じ校区を出す */
    try { localStorage.setItem("borro.gomi", id); } catch (e) {}

    render(area);
    out.hidden = false;
  }

  function render(area) {
    const now = new Date();
    const t = on(area, now);

    /* --- 今日の大きなカード --- */
    let next = null;
    for (let i = 1; i <= 40; i++) {
      const d = addDays(now, i);
      const k = on(area, d);
      if (k.length) { next = { d, k }; break; }
    }
    const nextTxt = next
      ? `${next.d.getMonth() + 1}月${next.d.getDate()}日（${WD[next.d.getDay()]}）の`
        + next.k.map(x => KIND[x].label).join("と")
      : "";

    /* カードの地色は、その日に出す袋の色にする */
    today.className = "gomi-today" + (t.length ? " has " + KIND[t[0]].t : "");
    today.innerHTML = `
      <p class="gt-date">${now.getMonth() + 1}月${now.getDate()}日（${WD[now.getDay()]}）・${area.full}</p>
      ${t.length
        ? `<p class="gt-lead">今日は</p>
           <p class="gt-kind">${t.map(x => KIND[x].label).join("<br>")}</p>
           <p class="gt-lead">の日です</p>
           <p class="gt-bag">${t.map(x =>
              `<i class="${KIND[x].bag}"></i>${KIND[x].bagName}`).join("")}</p>
           <p class="gt-sub">朝7時から8時までに集積所へ</p>`
        : `<p class="gt-kind gt-none">収集はありません</p>
           <p class="gt-sub">次は ${nextTxt}</p>`}
      ${t.length && next ? `<p class="gt-next">次は ${nextTxt}</p>` : ""}
    `;

    /* --- これから7日ぶん --- */
    let html = "";
    for (let i = 0; i < 7; i++) {
      const d = addDays(now, i);
      const k = on(area, d);
      html += `
        <div class="gw-day${i === 0 ? " gw-today" : ""}${k.length ? "" : " gw-empty"}">
          <span class="gw-w w${d.getDay()}">${WD[d.getDay()]}</span>
          <span class="gw-d">${d.getDate()}</span>
          <span class="gw-k">${
            k.length ? k.map(x => `<i class="${KIND[x].cls}">${KIND[x].short}</i>`).join("")
                     : "<i class=\"k-none\">—</i>"}</span>
        </div>`;
    }
    week.innerHTML = html;

    /* 色の意味（袋の色そのもの） */
    const lg = document.getElementById("gomiLegend");
    if (lg) lg.innerHTML =
      '<span><i class="b-burn"></i>もえる</span>' +
      '<span><i class="b-non"></i>もえない</span>' +
      '<span><i class="b-rec"></i>資源</span>' +
      "<em>色は指定ごみ袋と同じです</em>";

    /* --- この校区の決まった曜日 --- */
    const fixed = document.getElementById("gomiFixed");
    if (fixed) fixed.remove();
    const anchor = document.getElementById("gomiLegend") || week;
    anchor.insertAdjacentHTML("afterend", `
      <dl class="gomi-fixed" id="gomiFixed">
        <div class="f-burn"><dt>もえるごみ</dt><dd>${area.say.burn}</dd></div>
        <div class="f-non"><dt>もえないごみ</dt><dd>${area.say.nonburn}</dd></div>
        <div class="f-rec"><dt>資源ごみ</dt><dd>${area.say.recycle}</dd></div>
      </dl>`);
  }

  /* 前に選んだ校区があれば、開いた時点で出す */
  let saved = null;
  try { saved = localStorage.getItem("borro.gomi"); } catch (e) {}
  if (saved && AREAS.some(a => a.id === saved)) choose(saved);
})();


/* ==========================================================================
   2. 給付・助成・手当
   --------------------------------------------------------------------------
   出典：枕崎市公式サイト各ページ。制度名・所管課・URLは事実なのでそのまま。
   説明文は市の文章の転載ではなく、こちらで書いた要約。
   ★金額や要件は変わる。必ず担当課に確認してもらう前提で作る。
   ========================================================================== */
(function () {
  const B = "https://www.city.makurazaki.lg.jp";

  /* [制度名, 所管課, 対象タグ, URL, 一言説明, 担当課が推定なら1]

     ★担当課について
       市の一覧に所管課が明記されているものは、その表記をそのまま使っている。
       子育てサイトと移住サイトの一覧には所管課の記載がないため、
       同じ区分の他の制度から推定した。推定したものには印を付けて、
       画面にも「※」と注記を出す。**推定を事実として出さない。** */
  const SUP = [
    /* --- 子育て・妊娠出産 --- */
    ["児童手当", "健康・こども課", "child", "/site/kosodate/25757.html", "", 1],
    ["児童扶養手当", "健康・こども課", "child", "/site/kosodate/304.html", "ひとり親家庭などが対象", 1],
    ["特別児童扶養手当", "健康・こども課", "child", "/site/kosodate/28700.html", "障害のある児童を育てる家庭が対象", 1],
    ["障害児福祉手当", "健康・こども課", "child", "/site/kosodate/5338.html", "", 1],
    ["子ども医療費給付制度", "健康・こども課", "child", "/site/kosodate/21570.html", "子どもの医療費の助成", 1],
    ["就学援助制度", "教育委員会", "child", "/site/kosodate/416.html", "学用品費・給食費などの援助", 1],
    ["幼児教育・保育の無償化", "健康・こども課", "child", "/site/kosodate/12467.html", "", 1],
    ["保育所等入所児童おむつ給付事業", "健康・こども課", "child", "/site/kosodate/19829.html", "", 1],
    ["むぞかベイビー誕生祝金・出生祝記念品", "健康・こども課", "child", "/site/kosodate/15276.html", "出生のお祝い", 1],
    ["枕崎市産後ケア事業", "健康・こども課", "child", "/site/kosodate/22221.html", ""],
    ["枕崎市妊婦のための支援給付金", "健康・こども課", "child", "/site/kosodate/22981.html", ""],
    ["枕崎市不妊治療費助成事業", "健康・こども課", "child", "/site/kosodate/19832.html", "", 1],
    ["ひとり親家庭医療費", "健康・こども課", "child", "/site/kosodate/5330.html", "", 1],
    ["ひとり親家庭自立支援給付金", "健康・こども課", "child", "/site/kosodate/23310.html", "資格取得や就職のための支援", 1],
    ["枕崎市子育て世帯応援デジタル商品券", "水産商工課", "child", "/soshiki/suisan/25516.html", ""],
    ["はり・きゅう・マッサージ施術料", "健康・こども課", "child", "/site/kosodate/5331.html", "", 1],

    /* --- 高齢者 --- */
    ["敬老祝金の支給", "長寿介護課", "senior", "/soshiki/houkatsu/300.html", ""],
    ["介護手当", "長寿介護課", "senior", "/soshiki/houkatsu/5335.html", "在宅で介護している家族への手当"],
    ["家族介護用品支給事業", "長寿介護課", "senior", "/soshiki/houkatsu/5333.html", ""],
    ["おむつ給付", "長寿介護課", "senior", "/soshiki/houkatsu/5332.html", ""],
    ["緊急通報装置の貸与", "長寿介護課", "senior", "/soshiki/houkatsu/5334.html", "ひとり暮らしの高齢者などが対象"],
    ["日常生活用具の給付・貸与", "長寿介護課", "senior", "/site/shinsei-navi/295.html", ""],
    ["福祉給食サービス", "長寿介護課", "senior", "/site/shinsei-navi/296.html", ""],
    ["交通弱者に対するタクシー運賃の助成", "福祉課", "senior", "/soshiki/fukushi/12305.html", "移動が難しい方のタクシー代を助成"],

    /* --- 障害のある人 --- */
    ["ヘルプマーク・ヘルプカードの配布", "福祉課", "handi", "/soshiki/fukushi/29569.html", "無料で受け取れる"],
    ["南薩地区障害福祉サービス事業所案内マップ", "福祉課", "handi", "/soshiki/fukushi/27160.html", "制度ではなく案内資料"],
    ["「つなぐ窓口」障害者差別に関する相談", "福祉課", "handi", "/soshiki/fukushi/27548.html", ""],

    /* --- くらしの困りごと --- */
    ["くらし応援「使エール商品券」給付事業", "総務課", "life", "/soshiki/soumu/28400.html", ""],
    ["生活困窮者自立支援制度", "福祉課", "life", "/soshiki/fukushi/18270.html", "家計や就労の相談"],
    ["生活保護", "福祉課", "life", "/soshiki/fukushi/310.html", ""],
    ["地域猫活動に補助金を交付します", "市民生活課", "life", "/soshiki/shimin/19751.html", "不妊去勢手術などが対象"],
    ["令和8年度コミュニティ助成事業の募集", "企画調整課", "life", "/soshiki/kikaku/27398.html", "自治会・団体向け"],

    /* --- 結婚・移住・住まい --- */
    ["結婚新生活支援事業", "企画調整課", "move", "/soshiki/kikaku/14006.html", "新婚世帯の住居費・引越費用を支援"],
    ["移住者住宅取得補助", "企画調整課", "move", "/site/ijyu/", "新築70万円、市内業者と契約ならさらに30万円など", 1],
    ["移住支援金", "企画調整課", "move", "/site/ijyu/", "東京圏からの移住と就業等で最大100万円", 1],
    ["空き家バンク利用促進事業補助金", "企画調整課", "move", "/site/ijyu/7875.html", "", 1],
    ["空き家バンク（物件一覧）", "企画調整課", "move", "/site/ijyu/list17-363.html", "制度ではなく物件の一覧", 1],

    /* --- しごと・お店 --- */
    ["若者就労者支援直接支払給付金事業", "水産商工課", "work", "/soshiki/suisan/29303.html", "令和8年度の新規事業"],
    ["枕崎市チャレンジショップ促進支援事業補助金", "水産商工課", "work", "/site/ijyu/5707.html", "お店を始めたい人向け"],
    ["枕崎市商店等新規出店支援事業補助金", "水産商工課", "work", "/site/ijyu/5692.html", "新しく出店する人向け"],
  ];

  const TAGS = [
    ["all",    "すべて"],
    ["child",  "子育て・出産"],
    ["senior", "高齢者"],
    ["handi",  "障害のある人"],
    ["life",   "くらしの困りごと"],
    ["move",   "結婚・移住・住まい"],
    ["work",   "しごと・お店"],
  ];

  const chips = document.getElementById("supChips");
  const list  = document.getElementById("supList");
  const count = document.getElementById("supCount");
  if (!chips) return;

  let now = "all";

  TAGS.forEach(([id, label]) => {
    const n = id === "all" ? SUP.length : SUP.filter(s => s[2] === id).length;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (id === "all" ? " on" : "");
    b.dataset.id = id;
    b.innerHTML = `${label}<span class="chip-n">${n}</span>`;
    b.addEventListener("click", () => {
      now = id;
      chips.querySelectorAll(".chip").forEach(c => c.classList.toggle("on", c.dataset.id === id));
      draw();
    });
    chips.appendChild(b);
  });

  function draw() {
    const rows = now === "all" ? SUP : SUP.filter(s => s[2] === now);
    count.textContent = `${rows.length} 件`;
    list.innerHTML = rows.map(([name, dept, , path, note, guess]) => `
      <a class="sup-item" href="${B}${path}" target="_blank" rel="noopener">
        <span class="sup-name">${name}</span>
        ${note ? `<span class="sup-note">${note}</span>` : ""}
        <span class="sup-dept">${dept}${guess ? '<i class="sup-q">※</i>' : ""}</span>
      </a>`).join("");
  }
  draw();
})();


/* ==========================================================================
   3. 市のお金（サンキー図）
   --------------------------------------------------------------------------
   ライブラリは使わない。歳入 → 総額 → 歳出 の1段だけなので、
   積み上げた帯をベジェ曲線でつなぐだけで足りる。
   ========================================================================== */
(function () {
  const TOTAL = 15270000;                     /* 千円 */

  const IN = [
    ["地方交付税",   4100000, "＋2.5%",  "国から配られるお金。使いみちは市が決められる"],
    ["市税",         2170333, "＋2.2%",  "市民と事業者が納める税金"],
    ["国庫支出金",   1868605, "△14.0%",  "国が使いみちを決めて出すお金"],
    ["ふるさと納税", 1846016, "＋12.2%", "市外の人からの寄附"],
    ["繰入金",       1757330, "＋22.0%", "市の貯金（基金）から取り崩す分"],
    ["市債",         1290900, "＋11.3%", "市の借金。あとで返す"],
    ["県支出金",      981836, "△11.3%",  "県が使いみちを決めて出すお金"],
    ["その他",       1254980, "",        "地方消費税交付金、使用料、財産収入など14項目"],
  ];

  const OUT = [
    ["民生費",       4527961, "＋3.2%",   "福祉、子育て、高齢者、障害のある人"],
    ["総務費",       3968688, "＋6.6%",   "市役所の運営、ふるさと納税の事務、基金への積立"],
    ["公債費",       1308886, "＋3.2%",   "借金の返済"],
    ["土木費",       1303394, "△17.7%",   "道路、河川、公園、住宅"],
    ["消防費",       1139062, "＋126.6%", "消防、救急、防災。今年度は2倍以上に増えた"],
    ["教育費",       1119288, "△8.1%",    "学校、給食、社会教育、体育"],
    ["衛生費",        892351, "△7.0%",    "保健、ごみ処理、環境"],
    ["農林水産業費",  591846, "△29.0%",   "農業、林業、水産業への支援"],
    ["その他",        418524, "",         "商工費、議会費、労働費、災害復旧費など6項目"],
  ];

  const svg  = document.getElementById("sankey");
  const read = document.getElementById("finRead");
  if (!svg) return;
  const NS = "http://www.w3.org/2000/svg";

  const TOP = 24, H = 830;
  const LX = 6,   LW = 9;
  const CX = 171, CW = 18;
  const RX = 345, RW = 9;
  const GAP = 5;

  const el = (n, a) => {
    const e = document.createElementNS(NS, n);
    for (const k in a) e.setAttribute(k, a[k]);
    return e;
  };

  const oku = v => {
    const yen = v * 1000;
    const o = Math.floor(yen / 100000000);
    const m = Math.round((yen - o * 100000000) / 10000);
    return o > 0 ? o + "億" + (m > 0 ? m.toLocaleString() + "万" : "") + "円"
                 : m.toLocaleString() + "万円";
  };

  const stack = rows => {
    const usable = H - GAP * (rows.length - 1);
    let y = TOP; const r = [];
    rows.forEach(x => { const h = x[1] / TOTAL * usable; r.push({ y0: y, y1: y + h, h }); y += h + GAP; });
    return r;
  };
  const run = rows => {
    let y = TOP; const r = [];
    rows.forEach(x => { const h = x[1] / TOTAL * H; r.push({ y0: y, y1: y + h }); y += h; });
    return r;
  };
  const li = stack(IN), ri = stack(OUT), ci = run(IN), co = run(OUT);

  const ribbon = (x1, a, x2, b) => {
    const m = (x1 + x2) / 2;
    return "M" + x1 + "," + a.y0 + " C" + m + "," + a.y0 + " " + m + "," + b.y0 + " " + x2 + "," + b.y0 +
           " L" + x2 + "," + b.y1 + " C" + m + "," + b.y1 + " " + m + "," + a.y1 + " " + x1 + "," + a.y1 + " Z";
  };

  const frag = document.createDocumentFragment();

  /* 中央の柱。★このページで黄色を使うのは、ここと読み上げ欄の項目名だけ */
  frag.appendChild(el("rect", {
    x: CX, y: TOP, width: CW, height: H,
    fill: "#FFC41C", stroke: "#000", "stroke-width": 2, rx: 3
  }));

  const build = (rows, side) => {
    rows.forEach((r, i) => {
      const name = r[0], val = r[1], diff = r[2], desc = r[3];
      const near = side === "in" ? li[i] : ri[i];
      const far  = side === "in" ? ci[i] : co[i];

      const g = el("g", { class: "fin-band", tabindex: "0", role: "button",
                          "aria-label": name + " " + oku(val) });

      g.appendChild(el("path", {
        class: "fin-ribbon",
        d: side === "in" ? ribbon(LX + LW, near, CX, far) : ribbon(CX + CW, far, RX, near),
        fill: "#000", opacity: i % 2 ? 0.12 : 0.18
      }));
      g.appendChild(el("rect", {
        x: side === "in" ? LX : RX, y: near.y0,
        width: side === "in" ? LW : RW, height: Math.max(near.h, 1),
        fill: "#000", rx: 2
      }));

      const cy  = (near.y0 + near.y1) / 2;
      const two = near.h >= 27;
      const tx  = side === "in" ? LX + LW + 8 : RX - 8;
      const anc = side === "in" ? "start" : "end";

      const t1 = el("text", { x: tx, y: two ? cy - 2 : cy + 4, "text-anchor": anc, class: "fin-name" });
      t1.textContent = name;
      g.appendChild(t1);

      if (two) {
        const t2 = el("text", { x: tx, y: cy + 12, "text-anchor": anc, class: "fin-val" });
        t2.textContent = oku(val) + "・" + (val / TOTAL * 100).toFixed(1) + "%";
        g.appendChild(t2);
      }

      const show = () => {
        svg.querySelectorAll(".fin-band").forEach(b => b.classList.remove("on"));
        g.classList.add("on");
        read.innerHTML =
          "<b>" + name + "</b>" +
          '<span class="fin-read-v">' + oku(val) + "</span>" +
          '<span class="fin-read-p">' + (val / TOTAL * 100).toFixed(1) + "%" +
          (diff ? "　前年度 " + diff : "") + "</span>" +
          '<span class="fin-read-d">' + desc + "</span>";
      };
      g.addEventListener("pointerenter", show);
      g.addEventListener("pointerdown", show);
      g.addEventListener("focus", show);
      frag.appendChild(g);
    });
  };
  build(IN, "in");
  build(OUT, "out");

  const cap = el("text", { x: CX + CW / 2, y: TOP - 9, "text-anchor": "middle", class: "fin-cap" });
  cap.textContent = "152億7,000万円";
  frag.appendChild(cap);

  svg.appendChild(frag);
})();


/* ==========================================================================
   4. 今日の当番医（日曜・祝日）
   --------------------------------------------------------------------------
   出典：枕崎市医師会「令和8年度 日曜・祝日在宅医表」
        （市HP掲載PDF `uploaded/attachment/21741.pdf`／令和8年4月〜令和9年4月）

   ★病院名は「枕崎市医師会の正式名称」を使う。
     Google Places の表記とは4件違っていた（サザン・リージョン／尾辻／茅野／園田）。
     医療の情報で名前を間違えるのは致命的なので、必ず医師会の表記を正とする。

   ★当番表は変更されることがある。画面では必ず「電話で確認」を先に出す。
   ========================================================================== */
(function () {

  /* 略号 → [正式名称, 電話, 科] */
  const DR = {
    "小原":     ["小原病院",                     "0993-72-2226", ""],
    "サザン":   ["サザン・リージョン病院",       "0993-72-1351", ""],
    "国見":     ["国見内科医院",                 "0993-72-0066", ""],
    "尾辻":     ["尾辻病院",                     "0993-72-5001", ""],
    "茅野":     ["茅野内科医院",                 "0993-72-1006", ""],
    "有山":     ["有山内科",                     "0993-72-5811", ""],
    "枕崎市立": ["枕崎市立病院",                 "0993-72-0303", ""],
    "久木田":   ["久木田整形外科病院",           "0993-72-3155", ""],
    "立神":     ["立神リハビリテーション温泉病院","0993-72-7711", "リハビリ"],
    "眼":       ["園田病院",                     "0993-72-0165", "眼科"],
    "皮":       ["神園ひふ科クリニック",         "0993-73-2121", "皮膚科"],
    "耳鼻":     ["松山医院",                     "0993-72-5050", "耳鼻科"],
    "精":       ["ウエルフェア九州病院",         "0993-72-0055", "精神科"],
  };

  /* [日付, 内科, 外科, 特別科] ── 全80日 */
  const TOBAN = [
    ["2026-04-05", "小原", "小原", ""],
    ["2026-04-12", "サザン", "サザン", ""],
    ["2026-04-19", "国見", "尾辻", ""],
    ["2026-04-26", "茅野", "小原", ""],
    ["2026-04-29", "有山", "サザン", ""],
    ["2026-05-03", "小原", "小原", ""],
    ["2026-05-04", "サザン", "サザン", ""],
    ["2026-05-05", "枕崎市立", "久木田", ""],
    ["2026-05-06", "茅野", "尾辻", ""],
    ["2026-05-10", "国見", "小原", ""],
    ["2026-05-17", "サザン", "サザン", "精"],
    ["2026-05-24", "有山", "久木田", "耳鼻"],
    ["2026-05-31", "枕崎市立", "尾辻", ""],
    ["2026-06-07", "小原", "小原", "立神"],
    ["2026-06-14", "サザン", "サザン", "眼"],
    ["2026-06-21", "茅野", "小原", ""],
    ["2026-06-28", "枕崎市立", "サザン", ""],
    ["2026-07-05", "有山", "小原", ""],
    ["2026-07-12", "サザン", "サザン", ""],
    ["2026-07-19", "茅野", "小原", "精"],
    ["2026-07-20", "枕崎市立", "久木田", ""],
    ["2026-07-26", "国見", "サザン", "耳鼻"],
    ["2026-08-02", "小原", "小原", ""],
    ["2026-08-09", "サザン", "サザン", ""],
    ["2026-08-11", "有山", "久木田", ""],
    ["2026-08-14", "枕崎市立", "小原", ""],
    ["2026-08-15", "枕崎市立", "尾辻", ""],
    ["2026-08-16", "サザン", "サザン", ""],
    ["2026-08-23", "茅野", "久木田", "眼"],
    ["2026-08-30", "国見", "尾辻", "皮"],
    ["2026-09-06", "有山", "小原", "立神"],
    ["2026-09-13", "サザン", "サザン", ""],
    ["2026-09-20", "国見", "久木田", "精"],
    ["2026-09-21", "枕崎市立", "尾辻", ""],
    ["2026-09-22", "小原", "小原", ""],
    ["2026-09-23", "サザン", "サザン", ""],
    ["2026-09-27", "茅野", "久木田", ""],
    ["2026-10-04", "枕崎市立", "小原", ""],
    ["2026-10-11", "サザン", "サザン", ""],
    ["2026-10-12", "有山", "久木田", ""],
    ["2026-10-18", "小原", "小原", ""],
    ["2026-10-25", "国見", "サザン", "眼"],
    ["2026-11-01", "有山", "小原", "立神"],
    ["2026-11-03", "枕崎市立", "久木田", ""],
    ["2026-11-08", "サザン", "サザン", ""],
    ["2026-11-15", "小原", "小原", ""],
    ["2026-11-22", "茅野", "尾辻", ""],
    ["2026-11-23", "国見", "サザン", "皮"],
    ["2026-11-29", "枕崎市立", "久木田", "耳鼻"],
    ["2026-12-06", "サザン", "サザン", ""],
    ["2026-12-13", "国見", "尾辻", ""],
    ["2026-12-20", "茅野", "小原", ""],
    ["2026-12-27", "サザン", "サザン", ""],
    ["2026-12-29", "有山", "尾辻", "耳鼻"],
    ["2026-12-30", "枕崎市立", "久木田", ""],
    ["2026-12-31", "小原", "小原", ""],
    ["2027-01-01", "サザン", "サザン", ""],
    ["2027-01-02", "国見", "尾辻", ""],
    ["2027-01-03", "茅野", "久木田", ""],
    ["2027-01-10", "枕崎市立", "小原", ""],
    ["2027-01-11", "サザン", "サザン", ""],
    ["2027-01-17", "有山", "尾辻", "皮"],
    ["2027-01-24", "小原", "小原", ""],
    ["2027-01-31", "枕崎市立", "久木田", ""],
    ["2027-02-07", "小原", "小原", "立神"],
    ["2027-02-11", "サザン", "サザン", "皮"],
    ["2027-02-14", "枕崎市立", "尾辻", ""],
    ["2027-02-21", "有山", "サザン", ""],
    ["2027-02-23", "茅野", "久木田", ""],
    ["2027-02-28", "国見", "小原", ""],
    ["2027-03-07", "サザン", "サザン", "精"],
    ["2027-03-14", "小原", "小原", "眼"],
    ["2027-03-21", "枕崎市立", "久木田", ""],
    ["2027-03-22", "国見", "サザン", ""],
    ["2027-03-28", "有山", "小原", ""],
    ["2027-04-04", "サザン", "サザン", ""],
    ["2027-04-11", "小原", "小原", ""],
    ["2027-04-18", "枕崎市立", "サザン", ""],
    ["2027-04-25", "国見", "小原", ""],
    ["2027-04-29", "茅野", "久木田", ""],
  ];

  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const host = document.getElementById("tobanOut");
  if (!host) return;

  const ymd = d => d.getFullYear() + "-"
    + String(d.getMonth() + 1).padStart(2, "0") + "-"
    + String(d.getDate()).padStart(2, "0");

  const card = (key, label) => {
    const info = DR[key];
    if (!info) return "";
    return `
      <a class="tb-dr" href="tel:${info[1]}">
        <span class="tb-sec">${label}${info[2] ? "・" + info[2] : ""}</span>
        <span class="tb-name">${info[0]}</span>
        <span class="tb-tel">☎ ${info[1]}</span>
      </a>`;
  };

  const now = new Date();
  const key = ymd(now);
  const hit = TOBAN.find(r => r[0] === key);
  const next = TOBAN.find(r => r[0] > key);

  const nextTxt = next
    ? (() => {
        const p = next[0].split("-").map(Number);
        const d = new Date(p[0], p[1] - 1, p[2]);
        return `${p[1]}月${p[2]}日（${WD[d.getDay()]}）`;
      })()
    : "";

  host.innerHTML = `
    <div class="tb-top${hit ? " has" : ""}">
      <p class="tb-date">${now.getMonth() + 1}月${now.getDate()}日（${WD[now.getDay()]}）</p>
      ${hit
        ? `<p class="tb-lead">今日の当番医</p>
           <div class="tb-list">
             ${card(hit[1], "内科")}
             ${card(hit[2], "外科")}
             ${hit[3] ? card(hit[3], "特別科") : ""}
           </div>
           <p class="tb-hours">受付は午前9時から午後5時まで</p>`
        : `<p class="tb-none">今日は当番医の日ではありません</p>
           <p class="tb-sub">当番医が出るのは日曜・祝日・お盆・年末年始です。<br>
             次は <b>${nextTxt}</b></p>`}
    </div>

    <div class="tb-emerg">
      <p class="tb-emerg-h">行く前に、必ず電話で確認してください</p>
      <p>当番表は変更されることがあります。夜間の救急当番も下記へ。</p>
      <a class="tb-call" href="tel:0993-72-0049">
        <b>枕崎市消防本部</b><span>0993-72-0049</span>
      </a>
      <p class="tb-119">命に関わるときは、迷わず <b>119</b> へ。</p>
    </div>

    <details class="fin-note">
      <summary>当番医について</summary>
      <div>
        <p><b>出典</b><br>
          枕崎市医師会「令和8年度 日曜・祝日在宅医表」（市の公開PDF）。
          病院名は医師会の正式名称を使っています。</p>
        <p><b>応急処置のためのものです</b><br>
          急を要しない症状は、平日の受診をお願いします。
          当番医は病院で待機しているため、往診はありません。</p>
        <p><b>特別科について</b><br>
          眼科・皮膚科・耳鼻科・精神科・リハビリは、日によって追加されます。
          載っていない日は当番がありません。</p>
        <p class="fin-disc">
          変更が反映されていない可能性があります。
          受診の前に必ず電話でご確認ください。
        </p>
      </div>
    </details>
  `;
})();
