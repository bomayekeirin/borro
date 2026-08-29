/* ==========================================================================
   bo-rro !（borro） ─ データ
   --------------------------------------------------------------------------
   ★店を追加するときは、このファイルの SHOPS に1行足すだけ。
     各ページのHTMLを触る必要はない。
   ★全件 status:"draft" ＝ 店舗の許諾前。公開時に "published" に変える。
   ★他サイトの説明文・点数は転載しない。lead は自前の要約。
   ========================================================================== */

const CATEGORIES = [
  { id:"eat",    label:"食べる",   note:"かつお、ラーメン、食堂",       color:"#E8512B", ready:true  },
  { id:"drink",  label:"飲む",     note:"居酒屋、スナック、バー",       color:"#C42A6E", ready:true  },
  { id:"go",     label:"出かける", note:"海、温泉、イベント",           color:"#35A8C9", ready:false },
  { id:"beauty", label:"美容",     note:"髪、ネイル、整体",             color:"#6FCBB0", ready:false },
  { id:"life",   label:"暮らし",   note:"病院、買い物、市役所",         color:"#2F62AA", ready:false },
  { id:"work",   label:"はたらく", note:"枕崎・南さつま・南九州の求人", color:"#EFA92B", ready:false },
];

/* 曜日キー：mon tue wed thu fri sat sun */
const SHOPS = [
  /* ===== 食べる ─ かつお・海鮮・食堂 =============================== */
  { slug:"daitoku", name:"だいとく", kana:"だいとく",
    cats:["eat"], primary:"eat", sub:"katsuo", subLabel:"かつお料理",
    address:"折口町17", tel:"0993-72-0357",
    hours:"11:00-14:30 / 18:00-20:30", closed:["thu"],
    lead:"かつおラーメンを目当てに県外から人が来る。枕崎の食を一軒で説明できる店。",
    sig:{item:"かつおラーメン", price:"￥800前後"} },

  { slug:"manbou", name:"魚処まんぼう", kana:"うおどころまんぼう",
    cats:["eat","drink"], primary:"eat", sub:"katsuo", subLabel:"かつお料理",
    address:"恵比須町198-3", tel:"0993-72-0114",
    hours:"18:00-21:30", closed:["mon","tue"],
    lead:"夜だけ開く郷土料理店。かつおも鹿籠豚も、地のものが一通り揃う。",
    sig:{item:"鹿籠豚しゃぶ"} },

  { slug:"ippuku", name:"味処 一福", kana:"あじどころいっぷく",
    cats:["eat"], primary:"eat", sub:"kaisen", subLabel:"海鮮・食堂",
    address:"東本町8", tel:"0993-72-1025",
    hours:"11:00-14:00 / 17:00-21:00", closed:[],
    lead:"枕崎牛と鹿籠豚が同じ卓に並ぶ。海の町だが肉も強い、という一軒。" },

  { slug:"naniwa", name:"魚処 なにわ 栄", kana:"うおどころなにわさかえ",
    cats:["eat"], primary:"eat", sub:"kaisen", subLabel:"海鮮・食堂",
    address:"千代田町7-1", tel:"0993-72-0481",
    hours:"12:00-14:00 / 18:00-20:00", closed:[],
    lead:"枕崎駅から歩いてすぐ。電車で来て、降りてすぐ食べられる数少ない店。",
    sig:{item:"ぶえんかつお丼", price:"￥1,600"} },

  { slug:"minato-shokudo", name:"枕崎みなと食堂", kana:"まくらざきみなとしょくどう",
    cats:["eat","go"], primary:"eat", sub:"kaisen", subLabel:"海鮮・食堂",
    address:"松之尾町33-1", building:"枕崎お魚センター 潮風テラス",
    tel:"0993-73-2311", hours:"11:00-14:00（土日 -14:30）", closed:[],
    lead:"券売機で買って席で待つ。かつお節とだしがおかわり自由。港を見ながら食べられる。",
    sig:{item:"枕崎鰹船人めし"} },

  { slug:"one", name:"ONE", kana:"わん",
    cats:["eat","go"], primary:"eat", sub:"kaisen", subLabel:"海鮮丼",
    address:"岩戸町33", tel:"0993-76-1139",
    hours:"11:30-14:30 / 18:00-21:00", closed:["wed","thu","fri"],
    lead:"海が見える席で海鮮丼。営業日が少ないので、行く前に必ず確認を。" },

  { slug:"kikuya", name:"喜久家食堂", kana:"きくやしょくどう",
    cats:["eat"], primary:"eat", sub:"shokudo", subLabel:"食堂",
    address:"折口町8", tel:"0993-72-0377",
    hours:"11:00-14:00", closed:["wed","thu"],
    lead:"創業60年。かつおの町でカツ丼とチキン南蛮が名物という、ねじれが面白い。",
    sig:{item:"チキン南蛮"} },

  { slug:"yu", name:"お食事処 ゆう", kana:"おしょくじどころゆう",
    cats:["eat"], primary:"eat", sub:"shokudo", subLabel:"食堂",
    address:"岩崎町460", tel:"0993-72-7722",
    hours:"11:00-14:00 / 17:00-21:00", closed:["wed"],
    lead:"昼も夜も通しで使える食堂。チキン南蛮が定番。" },

  /* ===== 食べる ─ 麺 =============================================== */
  { slug:"ajihiro", name:"あじひろ", kana:"あじひろ",
    cats:["eat"], primary:"eat", sub:"ramen", subLabel:"ラーメン",
    address:"松之尾町16", tel:"0993-72-3432", hours:"不定", closed:[],
    lead:"三代で通う人がいる店。鹿児島とんこつと、期間限定のかつおラーメン。",
    sig:{item:"ラーメン", price:"￥750"} },

  { slug:"menyuki", name:"麺遊記", kana:"めんゆうき",
    cats:["eat"], primary:"eat", sub:"ramen", subLabel:"ラーメン",
    address:"立神本町445", tel:"0993-72-4756",
    hours:"11:00-14:00 / 18:00-21:00", closed:["tue"],
    lead:"担々麺と台湾味噌。枕崎で「かつお以外」を食べたくなった日に。" },

  { slug:"takara-ramen", name:"タカララーメン", kana:"たかららーめん",
    cats:["eat"], primary:"eat", sub:"ramen", subLabel:"ラーメン",
    address:"汐見町209", tel:"0993-72-4520",
    hours:"11:00-14:00 / 17:30-20:00", closed:["wed"],
    lead:"ラーメン屋だが、地元の人は焼きそばを頼む。",
    sig:{item:"焼きそば"} },

  { slug:"haohao-hanten", name:"好好飯店", kana:"はおはおはんてん",
    cats:["eat"], primary:"eat", sub:"chuka", subLabel:"中華",
    address:"汐見町201", tel:"080-4693-4947",
    hours:"11:00-14:00 / 17:00-22:00", closed:["mon"],
    lead:"平日の昼は待つこともある中華。ランチはソフトドリンクが付く。",
    sig:{item:"酸辣湯麺（大）", price:"￥1,150"} },

  /* ===== 食べる ─ 寿司・日本料理 ==================================== */
  { slug:"gojo", name:"すし匠 五条", kana:"すししょうごじょう",
    cats:["eat"], primary:"eat", sub:"sushi", subLabel:"寿司",
    address:"岩戸町509", tel:"0993-72-2230",
    hours:"11:30-14:00 / 17:00-21:30", closed:["mon"],
    lead:"枕崎で寿司といえばここ、と名前が挙がる一軒。" },

  { slug:"mizuho-sushi", name:"瑞穂寿し", kana:"みずほずし",
    cats:["eat"], primary:"eat", sub:"sushi", subLabel:"寿司",
    address:"新町1", tel:"0993-78-4688", closed:["sun"],
    lead:"10食限定の3段弁当がある。",
    reservation:"電話のみ（DMでの予約は受けていません）",
    ig:"mizuhosushi2014" },

  { slug:"suginoya", name:"すし 杉乃家", kana:"すしすぎのや",
    cats:["eat"], primary:"eat", sub:"sushi", subLabel:"寿司",
    address:"港町128-5", tel:"0993-72-6207",
    hours:"17:00-22:00（LO 21:00）", closed:["thu"],
    lead:"夜だけ開く寿司屋。港町の一角。", ig:"suginoya.0320" },

  { slug:"oota", name:"和懐 おお田", kana:"わかいおおた",
    cats:["eat"], primary:"eat", sub:"washoku", subLabel:"日本料理",
    address:"西本町59", tel:"0993-78-4345",
    hours:"11:00-14:00（土日祝のみ）/ 17:30-22:00", closed:["tue"],
    lead:"人をもてなす日のための店。南薩3市への配達もしている。",
    delivery:"枕崎市・南さつま市・南九州市（指宿市は要相談）",
    ig:"wakaiota" },

  /* ===== 食べる ─ 肉・串・弁当 ===================================== */
  { slug:"goemon", name:"焼肉 伍右衛門", kana:"やきにくごえもん",
    cats:["eat"], primary:"eat", sub:"yakiniku", subLabel:"焼肉",
    address:"立神本町456", tel:"0993-72-7431", closed:["tue"], irregular:true,
    lead:"黒毛和牛A4〜A5。前日までに予約がないと、月か水も休むことがある。",
    reservation:"電話（要予約）", ig:"yakinikugoemon" },

  { slug:"koume", name:"串揚げ処 小梅", kana:"くしあげどころこうめ",
    cats:["eat","drink"], primary:"eat", sub:"kushiage", subLabel:"串揚げ",
    address:"立神本町147", tel:"070-4353-8659",
    hours:"18:30-（フード LO 21:00）", closed:["wed"],
    lead:"2026年7月末に開いたばかりの串揚げ屋。枕崎では珍しい業態。",
    reservation:"Instagram DM または 電話", ig:"coume.324" },

  { slug:"tatsujin-bentou", name:"タツジン弁当", kana:"たつじんべんとう",
    cats:["eat"], primary:"eat", sub:"bento", subLabel:"弁当・惣菜",
    address:"折口町127", tel:"090-8838-1453",
    hours:"11:30-13:30 / 16:00-17:30", closed:[],
    lead:"日替わり弁当は毎日Instagramのストーリーで。焼き鳥もオードブルもある。",
    reservation:"web・LINE・電話（夕方の弁当とオードブルは前日まで）",
    delivery:"オードブル（要予約）", ig:"tatsujin.bentou" },

  /* ===== 食べる ─ カフェ =========================================== */
  { slug:"tsukimichi", name:"ツキミチ喫茶", kana:"つきみちきっさ",
    cats:["eat"], primary:"eat", sub:"cafe", subLabel:"カフェ",
    address:"汐見町195", hours:"10:30-17:00", closed:["wed","sun"], irregular:true,
    lead:"厨房に小麦を持ち込まない、完全グルテンフリーの喫茶。米粉やおから粉で焼いた菓子とエスプレッソ。",
    dietary:"グルテンフリー（厨房に小麦を持ち込まない）",
    reservation:"ホールケーキは DM または直接来店", ig:"tsukimichi31" },

  { slug:"laftel", name:"LAFTEL（ラフテル）", kana:"らふてる",
    cats:["eat"], primary:"eat", sub:"cafe", subLabel:"カフェ",
    address:"汐見町160", hours:"10:00-12:00 / 13:30-17:30", closed:["mon"], irregular:true,
    lead:"クレープ専門店。昼と午後で一度閉まる。臨時休業が多いので、行く前にInstagramを。",
    payment:"現金・PayPay・メルペイ・d払い・payどん（クレジットカード不可）",
    parking:"あり（台数に限りあり・乗り合わせ推奨）", ig:"artcafe.laftel" },

  { slug:"yamaneko", name:"山猫瓶詰研究所", kana:"やまねこびんづめけんきゅうじょ",
    cats:["eat","go"], primary:"eat", sub:"cafe", subLabel:"カフェ",
    address:"金山町722", tel:"0993-78-3643",
    hours:"12:00-16:30", closed:["mon","tue"],
    lead:"旧郵便局を改装したカフェ。奥に時間貸しの「秘密の部屋」がある。",
    sig:{item:"秘密の部屋", price:"￥1,000 / 1時間"} },

  { slug:"kotokoto-cafe", name:"kotokoto cafe", kana:"ことことかふぇ",
    cats:["eat"], primary:"eat", sub:"cafe", subLabel:"カフェ",
    address:"住吉町57-1", hours:"11:00-16:00", closed:["mon","tue","wed","thu"],
    lead:"金・土・日だけ開く。おにぎりランチは15食限定。" },

  { slug:"pukupuku", name:"ぷくぷくCAFE", kana:"ぷくぷくかふぇ",
    cats:["eat","go"], primary:"eat", sub:"cafe", subLabel:"カフェ",
    address:"松之尾町33-1", building:"枕崎お魚センター 潮風テラス",
    hours:"9:00-17:00", closed:[],
    lead:"お魚センターの中。港を見ながら一息つける。" },

  { slug:"old-man", name:"カフェ ザ オールドマン", kana:"かふぇざおーるどまん",
    cats:["eat"], primary:"eat", sub:"cafe", subLabel:"カフェ",
    address:"港町1", closed:[], lead:"港町の喫茶店。" },

  /* ===== 食べる ─ パン・菓子 ======================================= */
  { slug:"verdi", name:"ヴェルディ", kana:"う゛ぇるでぃ",
    cats:["eat"], primary:"eat", sub:"bakery", subLabel:"パン",
    address:"東本町35", tel:"0993-73-2428", hours:"7:40-18:00", closed:[],
    lead:"朝7時40分から開く。たこ焼きパンという謎の名物がある。",
    sig:{item:"たこ焼きパン"} },

  { slug:"koppe-tokyodo", name:"コッペ東京堂", kana:"こっぺとうきょうどう",
    cats:["eat"], primary:"eat", sub:"bakery", subLabel:"パン",
    address:"中町222", tel:"0993-72-8901",
    hours:"7:30-18:30", closed:["mon","wed","fri","sun"],
    lead:"開いている日が週三日。「ちびっこパン」を買えたら運がいい。",
    sig:{item:"ちびっこパン"} },

  { slug:"nodoka", name:"お菓子とパンの店 のどか", kana:"おかしとぱんのみせのどか",
    cats:["eat"], primary:"eat", sub:"bakery", subLabel:"パン",
    address:"緑町148", hours:"8:00-15:00（なくなり次第終了）",
    closed:["sun","mon"], irregular:true,
    lead:"お菓子とパンの店。売り切れたら閉まるので、朝のうちに。",
    payment:"電子マネー・PayPay・payどん", parking:"あり（3台）",
    ig:"o.p.87_nodoka" },

  { slug:"cardia-bakery", name:"カルディアベーカリー", kana:"かるでぃあべーかりー",
    cats:["eat"], primary:"eat", sub:"bakery", subLabel:"パン",
    address:"桜山本町579", tel:"080-2132-5205",
    hours:"9:30-15:30", closed:["tue","wed"],
    lead:"2025年秋にできたパン屋。旧Iショップの建物を使っている。" },

  { slug:"le-petit-bois", name:"le petit bois", kana:"るぷてぃぼあ",
    cats:["eat"], primary:"eat", sub:"sweets", subLabel:"洋菓子",
    address:"塩屋北町586", tel:"0993-78-3810",
    hours:"10:00-18:00", closed:["mon"],
    lead:"手土産に困ったらここ。ダブルフロマージュが看板。",
    sig:{item:"ダブルフロマージュ"} },

  { slug:"atsuishien-minato", name:"厚石園 港店", kana:"あついしえんみなとてん",
    cats:["eat","go"], primary:"eat", sub:"sweets", subLabel:"茶・甘味",
    address:"松之尾町34-2", building:"枕崎お魚センター かつお横丁", closed:[],
    lead:"自家茶葉の煎茶アフォガート。茶どころ枕崎らしい一品。",
    sig:{item:"煎茶アフォガート"} },

  /* ===== 飲む ─ バー =============================================== */
  { slug:"bar45", name:"BAR45", kana:"ばーよんごー",
    cats:["drink"], primary:"drink", sub:"bar", subLabel:"バー",
    address:"折口町92", building:"折口町92", hours:"21:00-", closed:["mon"],
    lead:"ダーツ2台とカラオケ。飲み放題は時間無制限。",
    charge:"飲み放題 無制限 ／ 男女 ￥2,500・ソフトドリンク ￥2,000",
    reservation:"Instagram DM", ig:"bar45_makurazaki" },

  { slug:"bar-billy", name:"BAR Billy", kana:"ばーびりー",
    cats:["drink"], primary:"drink", sub:"bar", subLabel:"バー",
    address:"折口町95-1", building:"折口町95-1",
    hours:"20:00-翌2:00", closed:[], irregular:true,
    lead:"2026年3月にできた店。ベティ・ブープとピンクの内装。キープ制あり。",
    charge:"フリータイム ／ 男女 ￥3,000・飲まない女性 ￥2,000",
    ig:"bar_billy108" },

  { slug:"heat", name:"HEAT", kana:"ひーと",
    cats:["drink"], primary:"drink", sub:"bar", subLabel:"ダーツバー",
    address:"折口町95-1", building:"折口町95-1",
    tel:"0993-72-5083", hours:"21:00-", closed:[],
    lead:"ダーツバー。予約と問い合わせは電話で。",
    reservation:"電話", x:"HEAT_dartsbar" },

  { slug:"bar-nine", name:"AMUSEMENT BAR nine", kana:"あみゅーずめんとばーないん",
    cats:["drink"], primary:"drink", sub:"bar", subLabel:"アミューズメントバー",
    address:"千代田町1", hours:"21:00 または 22:00 - 翌3:00", closed:[], irregular:true,
    lead:"ダーツ、ビリヤード、カラオケ、スロット。枕崎駅の近く。",
    reservation:"Instagram DM", ig:"nine_amusementbar" },

  { slug:"bubbry", name:"bubbry", kana:"ばぶりー",
    cats:["drink"], primary:"drink", sub:"bar", subLabel:"バー",
    address:"東本町151", tel:"090-2434-5471", hours:"20:00-", closed:[],
    lead:"貸切の予約もできる。「ド田舎だけど盛りあげるー！」が店の言葉。",
    reservation:"電話 または Instagram DM", ig:"bubbry0721" },

  { slug:"bamboo", name:"バンブー", kana:"ばんぶー",
    cats:["drink"], primary:"drink", sub:"bar", subLabel:"バー",
    address:"汐見町217", hours:"19:00-翌4:00（土 18:00-）", closed:[],
    lead:"カウンターとボックス席。会計が明朗だという評判の店。" },

  { slug:"bar-sakura", name:"Bar桜", kana:"ばーさくら",
    cats:["drink"], primary:"drink", sub:"bar", subLabel:"バー",
    address:"港町128", building:"港町128", tel:"0993-76-3006", closed:[],
    lead:"港町128番地。同じ建物にラウンジ蓮も入っている。" },

  { slug:"bar-cloud9", name:"BAR CLOUD9", kana:"ばーくらうどないん",
    cats:["drink"], primary:"drink", sub:"bar", subLabel:"バー",
    address:"新町1", tel:"0993-72-7975", closed:[],
    lead:"チャージなしで飲める。", charge:"チャージなし" },

  { slug:"abc-canon", name:"ABC. American Bar Canon", kana:"えーびーしーあめりかんばーきゃのん",
    cats:["drink","eat"], primary:"drink", sub:"bar", subLabel:"ダイニングバー",
    address:"東本町22", tel:"0993-72-9151", hours:"18:00-翌1:00", closed:[],
    lead:"ステーキやハンバーガーも出るバー。枕崎駅の隣。" },

  { slug:"dining-bar-engine", name:"Dining Bar ENGINE", kana:"だいにんぐばーえんじん",
    cats:["drink","eat"], primary:"drink", sub:"bar", subLabel:"ダイニングバー",
    address:"寿町454", tel:"0993-76-7333", hours:"18:00-23:00", closed:["wed","sun"],
    lead:"ログハウス調でジャズが流れる。かつお味噌のピザがある。" },

  /* ===== 飲む ─ スナック・ラウンジ ================================== */
  { slug:"snack-ryo", name:"スナック良", kana:"すなっくりょう",
    cats:["drink"], primary:"drink", sub:"snack", subLabel:"スナック",
    address:"汐見町212-1", tel:"0993-73-2438", hours:"20:00-24:30", closed:["sun"],
    lead:"カウンターと座敷で20席ほど。送迎もしてくれる。" },

  { slug:"lounge-ren", name:"ラウンジ蓮", kana:"らうんじれん",
    cats:["drink"], primary:"drink", sub:"snack", subLabel:"ラウンジ",
    address:"港町128", building:"港町128", tel:"0993-72-5560",
    hours:"18:00-24:00", closed:["mon","sun"], lead:"Bar桜と同じ建物。" },

  { slug:"mokaji", name:"モカジイ", kana:"もかじい",
    cats:["drink"], primary:"drink", sub:"snack", subLabel:"スナック",
    address:"中央町3", tel:"0993-72-7837", closed:[] },

  { slug:"maryquant", name:"Maryquant", kana:"まりーくぁんと",
    cats:["drink"], primary:"drink", sub:"snack", subLabel:"パブ",
    address:"港町1", tel:"0993-72-5700", closed:[] },

  /* ===== 飲む ─ カラオケ =========================================== */
  { slug:"oto-karaoke-pub", name:"oto カラオケpub", kana:"おとからおけぱぶ",
    cats:["drink"], primary:"drink", sub:"karaoke_snack", subLabel:"カラオケスナック",
    address:"折口町92", building:"折口町92", tel:"090-5024-4661",
    hours:"21:00-翌2:00", closed:[], irregular:true,
    lead:"カラオケ歌い放題。営業時間前の来店も相談できる。",
    charge:"飲み放題 2時間 ／ 男女 ￥2,500・延長 1人 ￥1,000",
    reservation:"電話 または Instagram DM", ig:"oto_karaoke_pub" },

  { slug:"coco-music-house", name:"ミュージックハウスCoCo", kana:"みゅーじっくはうすここ",
    cats:["drink"], primary:"drink", sub:"karaoke_snack", subLabel:"カラオケスナック",
    address:"高見町250", building:"CoCoハウス1F", closed:[],
    lead:"昭和のスナック時代から続くカラオケ店。森伊蔵・村尾・魔王も置いている。",
    ig:"coco250takami" },

  { slug:"night-and-day", name:"Night & Day", kana:"ないとあんどでい",
    cats:["drink"], primary:"drink", sub:"karaoke_bar", subLabel:"カラオケバー",
    address:"高見町250", building:"CoCoハウス1F", tel:"090-8668-7797",
    hours:"19:00-23:30", closed:["sun"],
    lead:"女性ひとりでも入りやすいと書いてある店。" },

  { slug:"love", name:"Love", kana:"らぶ",
    cats:["drink"], primary:"drink", sub:"karaoke_snack", subLabel:"カラオケスナック",
    address:"西本町83", tel:"080-6048-4492", closed:[],
    charge:"飲み放題＋歌い放題 2時間 ￥2,000" },

  { slug:"karaoke-plaza-utao", name:"カラオケプラザ唄王", kana:"からおけぷらざうたおう",
    cats:["drink","go"], primary:"drink", sub:"karaoke_box", subLabel:"カラオケボックス",
    address:"中央町398-2", tel:"0993-72-1888",
    hours:"13:00-翌1:00（金土 -翌2:00）", closed:["wed"],
    lead:"持ち込み自由。部屋代だけで歌える。" },

  { slug:"karaoke-poppo", name:"カラオケ ポッポ", kana:"からおけぽっぽ",
    cats:["drink","go"], primary:"drink", sub:"karaoke_box", subLabel:"カラオケボックス",
    address:"板敷西町253", tel:"0993-72-5679", hours:"14:00-翌2:00", closed:[],
    lead:"持ち込み自由。音響がいいと評判。" },

  /* ===== 飲む ─ 居酒屋 ============================================= */
  { slug:"kamikagura", name:"酒食堂 神神楽", kana:"さけしょくどうかみかぐら",
    cats:["drink","eat"], primary:"drink", sub:"izakaya", subLabel:"居酒屋",
    address:"立神本町169", closed:[],
    lead:"2024年秋にできた店。地酒が揃っていて、全席禁煙、座敷もある。" },

  { slug:"ebisuya", name:"みんなのゑびす家", kana:"みんなのえびすや",
    cats:["drink","eat"], primary:"drink", sub:"izakaya", subLabel:"居酒屋",
    address:"宮田町355", tel:"0993-72-1737", hours:"18:00-23:45", closed:["wed"],
    lead:"鮮魚の仲買人がやっている店。" },

  { slug:"chickenman", name:"大衆酒場チキンマン", kana:"たいしゅうさかばちきんまん",
    cats:["drink","eat"], primary:"drink", sub:"izakaya", subLabel:"居酒屋",
    address:"折口町19", tel:"0993-87-5445", hours:"17:00-24:00", closed:["sun"],
    lead:"福岡風の焼き鳥。折口町で早い時間から開いている。" },

  { slug:"fukurou", name:"呑喰厨房ふくろう", kana:"のみくいちゅうぼうふくろう",
    cats:["drink","eat"], primary:"drink", sub:"izakaya", subLabel:"居酒屋",
    address:"中町23", tel:"0993-72-2812", hours:"18:00-22:00", closed:["thu"],
    lead:"元漁師の店主。かつおの腹皮の刺身が出る。" },

  { slug:"tsuchifumazu", name:"居酒屋食堂つちふまず", kana:"いざかやしょくどうつちふまず",
    cats:["drink","eat"], primary:"drink", sub:"izakaya", subLabel:"居酒屋",
    address:"栄中町18", tel:"0993-72-1858",
    hours:"11:30-14:00 / 18:00-24:00", closed:[],
    lead:"昼はかき氷、夜は居酒屋。" },

  { slug:"madai", name:"焼酎庵 真鯛", kana:"しょうちゅうあんまだい",
    cats:["drink","eat"], primary:"drink", sub:"izakaya", subLabel:"居酒屋",
    address:"緑町43-2", tel:"080-2715-9139",
    hours:"11:30-13:30 / 18:00-23:00", closed:["tue"] },

  /* ===== 飲む ─ アミューズメント ==================================== */
  { slug:"round2", name:"ラウンド2", kana:"らうんどつー",
    cats:["drink","go"], primary:"drink", sub:"amusement", subLabel:"貸切スペース",
    address:"高見町273", building:"三愛ビル1F", tel:"080-9242-3627",
    hours:"12:00-翌5:00（昼は予約のみ）", closed:[],
    lead:"ゴルフ、カラオケ、ダーツができる貸切空間。昼から使える。",
    reservation:"電話", operator:"ラウンド2・ハナレ", ig:"hanare_round2" },

  { slug:"hanare", name:"ハナレ", kana:"はなれ",
    cats:["drink"], primary:"drink", sub:"amusement", subLabel:"貸切スペース",
    address:"高見町273", building:"三愛ビル1F", tel:"080-9242-3627",
    hours:"22:00-翌5:00", closed:[],
    lead:"ラウンド2の隣。深夜に強い。",
    reservation:"電話", operator:"ラウンド2・ハナレ", ig:"hanare_round2" },
];

/* --- 準備中カテゴリに表示する内容 ---------------------------------------- */
const SOON = {
  go: { collected: 35, plans: [
    "火之神公園、立神岩、日本最南端の始発・終着駅",
    "なぎさ温泉、まちの湯ひとっ風呂、黄金の湯",
    "枕崎お魚センター（かつお節削り体験・工場見学）",
    "南溟館、青空美術館、南方神社",
    "きばらん海 港まつり、かつおランニングDay などのイベント",
  ]},
  beauty: { collected: 78, plans: [
    "美容室28軒・理容室10軒（Googleでは13軒しか出てきません）",
    "整体・鍼灸・整骨院25軒を、症状から探せるように",
    "ネイルサロン、エステ、リラクゼーション",
    "枕崎駅から歩けるか、車がいるかも書きます",
  ]},
  life: { collected: 120, plans: [
    "今日のごみは何の日（枕崎・別府・桜山金山・立神の4校区別）",
    "日曜・祝日の当番医（内科／外科／特別科・1年分）",
    "病院16、スーパー・ドラッグストア19、教育10",
    "給付金・助成金・手当を、担当課つきで40件以上",
    "市の予算152.7億円が何に使われているか",
  ]},
  work: { collected: 0, plans: [
    "枕崎市・南さつま市・南九州市の求人だけ（ハローワークから毎日）",
    "フルリモートも、全国募集も、県外の会社の広告も出しません",
    "年齢不問、マイカー通勤可、週◯日から、託児施設あり で絞れます",
    "シニア歓迎・子育てと両立できる仕事",
  ]},
};
