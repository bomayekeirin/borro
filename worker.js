// =====================================================================
// 競輪BattleBank Worker（worker.js）  第29版（2026-10-05）  ※第29版：相手をランダムに募集するバトルルーム。着順を払戻の組み合わせからも読めるようにし、レースごとの「結果を更新」を追加
//   構成：GitHubのリポジトリ直下に全ファイルを置き、アップロード＝自動デプロイ（Workers Builds）。
//         /bb/ で始まるアドレスだけをこのファイルが処理し、それ以外は画面のファイル（index.html や画像）を返す。
//   設定は wrangler.jsonc が正。Cloudflareのダッシュボードのコードエディタでは保存しないこと。
//
//   用語：サービス名＝競輪BattleBank、1つ1つのバトルの場＝バトルルーム（コード内の「部屋」「room」はバトルルームのこと）
//
// wrangler.jsonc で設定するもの
//   ASSETS      … 画面のファイル（リポジトリ直下。.assetsignore で除外指定）
//   DB          … D1 データベース
//   SITE_ORIGIN … https://battlebank.me
//   ADMIN_HANDLES … 管理者のXのID（どのバトルルームも削除できる）
// ダッシュボードで「シークレット」として登録するもの（値はリポジトリに書かない）
//   X_CLIENT_ID / X_CLIENT_SECRET … Xの開発者画面で発行
//
// データベースの表は、最初のアクセス時にこのファイルが自動で作る（D1のコンソールでの実行は不要）。
//
// 含むもの  ：Xログイン、バトルルームの作成・招待・参加・辞退・成立判定、流入の記録（集客pt）、開催とレースの取得
// 未実装    ：シェアカード（工程4）／会員向け履歴（工程5）／回数制限・管理画面（工程6）
// =====================================================================

const BASE = '/bb';
const COOKIE = 'bb_session';
const SESSION_DAYS = 30;
const MAX_MEMBERS = 10;                                   // 作成者を含む上限
const STAKES = [1000, 1500, 2000, 3000, 5000, 10000, 15000];
const BET_TYPES = ['3t', '3f', '2t'];                     // 3連単・3連複・2車単
const NAME_MAX = 20;                                      // 表示名の最大文字数
const VISITOR_COOKIE = 'bb_vid';                          // 来場者を見分けるランダムな番号（個人を特定しない）
const VISIT_CAP_PER_IP = 5;                               // 同じ接続元から、1つのルームで1日に数える来場の上限
const RACE_KEY_RE = /^\d{8}-[a-z0-9_]{1,24}-\d{1,2}$/;    // YYYYMMDD-競輪場ID-レース番号
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
// 競輪場ID（Brain本体と同じ表記）。指定レースの競輪場はこの中にあるものだけ受け付ける
const VENUE_IDS = new Set([
  'hakodate', 'aomori', 'iwakidaira', 'yahiko', 'maebashi', 'toride', 'utsunomiya', 'omiya', 'seibuen',
  'keiokaku', 'tachikawa', 'matsudo', 'chiba', 'kawasaki', 'hiratsuka', 'odawara', 'ito', 'shizuoka',
  'nagoya', 'gifu', 'ogaki', 'toyohashi', 'toyama', 'matsusaka', 'yokkaichi', 'fukui', 'nara',
  'mukomachi', 'wakayama', 'kishiwada', 'tamano', 'hiroshima', 'hofu', 'takamatsu', 'komatsushima',
  'kochi', 'matsuyama', 'kokura', 'kurume', 'takeo', 'sasebo', 'beppu', 'kumamoto',
]);
// レースの指定が正しい形か（開催日・競輪場ID・レース番号1〜12）
function validRaceKey(key, ymd) {
  if (!RACE_KEY_RE.test(key)) return false;
  const [d, venue, num] = key.split('-');
  return d === ymd && VENUE_IDS.has(venue) && Number(num) >= 1 && Number(num) <= 12 && String(Number(num)) === num;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // /bb/ で始まらないアドレスは、画面のファイルを返す（該当するファイルがなければ「見つかりません」）
    if (!url.pathname.startsWith(BASE + '/')) return env.ASSETS.fetch(request);
    try {
      const limited = await rateLimit(request, env, url);
      if (limited) return limited;
      await ensureSchema(env);
      const res = await route(request, env);
      // バトルルームが開かれたついでに、結果の確認を裏で進める（定期実行の合間を埋める。間隔を空けて実行）
      if (request.method === 'GET' && /^\/bb\/api\/rooms\/[A-Za-z0-9]+$/.test(url.pathname) && ctx && ctx.waitUntil) {
        ctx.waitUntil(settleTick(env, false).catch((e) => console.error('settle error:', e && e.stack ? e.stack : e)));
      }
      return res;
    } catch (e) {
      console.error('bb error:', e && e.stack ? e.stack : e);
      return json({ error: 'server_error' }, 500);
    }
  },

  // 定期実行（wrangler.jsonc の triggers で指定。2分ごと）：結果の確認、的中の判定、バトルルームの終了
  async scheduled(event, env, ctx) {
    try {
      await ensureSchema(env);
      await settleTick(env, true);
    } catch (e) {
      console.error('scheduled error:', e && e.stack ? e.stack : e);
    }
  },
};

// ---------------------------------------------------------------------
// 回数制限（ロボット対策）
//   同じ接続元（IPアドレス）からのアクセスを、1分あたりの回数で制限する。上限は wrangler.jsonc の ratelimits で決める。
//     読み取り（GET）        … RL_READ
//     書き込み（POST）       … RL_WRITE
//     Xログインの開始        … RL_AUTH（ログインのたびにX APIの料金がかかるため、少なめ）
//   シェア用のアドレス（/bb/s/）は、Xなどがリンクカードを作るために読みに来るので、読み取りの枠で数える。
//   設定がない環境（接続元が分からない場合を含む）では、制限しない。
// ---------------------------------------------------------------------
async function rateLimit(request, env, url) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return null;
  const path = url.pathname;
  let limiter = request.method === 'GET' ? env.RL_READ : env.RL_WRITE;
  if (path === BASE + '/auth/login') limiter = env.RL_AUTH;
  if (path === BASE + '/api/premium' && request.method === 'POST') limiter = env.RL_CODE;
  if (!limiter || typeof limiter.limit !== 'function') return null;
  try {
    const { success } = await limiter.limit({ key: ip });
    if (success) return null;
  } catch (e) {
    return null;        // 回数制限の仕組みに問題があっても、サイトは止めない
  }
  return new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30', 'X-Robots-Tag': 'noindex' },
  });
}

// ---------------------------------------------------------------------
// データベースの表を自動で作る
//   Workerが起動して最初の依頼を受けたときに、表がそろっているかを確かめ、足りなければ作る。
//   すでにある表には触らない（IF NOT EXISTS）。内容は schema.sql と同じ。
// ---------------------------------------------------------------------
const SCHEMA_TABLES = 21;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bb_users ( user_id TEXT PRIMARY KEY, x_user_id TEXT UNIQUE, handle TEXT, x_name TEXT, display_name TEXT, icon_url TEXT, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')), premium_until INTEGER, hide_pt INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login_at INTEGER )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_users_handle ON bb_users(handle)`,
  `CREATE TABLE IF NOT EXISTS bb_sessions ( session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES bb_users(user_id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_sessions_user ON bb_sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS bb_oauth_states ( state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, return_to TEXT, created_at INTEGER NOT NULL )`,
  `CREATE TABLE IF NOT EXISTS bb_rooms ( room_id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES bb_users(user_id), state TEXT NOT NULL DEFAULT 'recruiting' CHECK (state IN ('recruiting','open','finished','void')), battle_date TEXT NOT NULL, race_count INTEGER NOT NULL CHECK (race_count >= 1), mode TEXT NOT NULL CHECK (mode IN ('fixed','free')), stake INTEGER NOT NULL CHECK (stake IN (1000,1500,2000,3000,5000,10000,15000)), bet_types TEXT NOT NULL, reveal_mode TEXT NOT NULL CHECK (reveal_mode IN ('instant','before_start')), reveal_minutes INTEGER, quorum TEXT NOT NULL CHECK (quorum IN ('all','two_plus')), join_deadline INTEGER NOT NULL, created_at INTEGER NOT NULL, established_at INTEGER, finished_at INTEGER, public_until INTEGER, no_winner INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, recruit TEXT NOT NULL DEFAULT 'invite', capacity INTEGER )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_rooms_state_date ON bb_rooms(state, battle_date)`,
  `CREATE INDEX IF NOT EXISTS idx_bb_rooms_creator ON bb_rooms(creator_id)`,
  `CREATE TABLE IF NOT EXISTS bb_room_races ( room_id TEXT NOT NULL REFERENCES bb_rooms(room_id), seq INTEGER NOT NULL, race_key TEXT NOT NULL, PRIMARY KEY (room_id, seq), UNIQUE (room_id, race_key) )`,
  `CREATE TABLE IF NOT EXISTS bb_invites ( room_id TEXT NOT NULL REFERENCES bb_rooms(room_id), handle TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')), user_id TEXT REFERENCES bb_users(user_id), responded_at INTEGER, PRIMARY KEY (room_id, handle) )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_invites_handle ON bb_invites(handle, status)`,
  `CREATE TABLE IF NOT EXISTS bb_members ( room_id TEXT NOT NULL REFERENCES bb_rooms(room_id), user_id TEXT NOT NULL REFERENCES bb_users(user_id), is_creator INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL, PRIMARY KEY (room_id, user_id) )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_members_user ON bb_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS bb_races ( race_key TEXT PRIMARY KEY, race_date TEXT NOT NULL, venue_id TEXT NOT NULL, venue_name TEXT NOT NULL, race_num INTEGER NOT NULL, cup_code TEXT, day_num INTEGER, start_at INTEGER, deadline_at INTEGER, fetched_at INTEGER NOT NULL, cancel INTEGER NOT NULL DEFAULT 0, status INTEGER )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_races_date ON bb_races(race_date)`,
  `CREATE TABLE IF NOT EXISTS bb_cups ( race_date TEXT NOT NULL, venue_id TEXT NOT NULL, cup_code TEXT NOT NULL, day_num INTEGER, fetched_at INTEGER NOT NULL, slot TEXT, finished INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (race_date, venue_id) )`,
  `CREATE TABLE IF NOT EXISTS bb_entries ( entry_id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES bb_rooms(room_id), user_id TEXT NOT NULL REFERENCES bb_users(user_id), race_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','settled','no_vote')), stake INTEGER NOT NULL, refund INTEGER NOT NULL DEFAULT 0, payout INTEGER NOT NULL DEFAULT 0, hit INTEGER NOT NULL DEFAULT 0, ticket_count INTEGER NOT NULL DEFAULT 0, submitted_at INTEGER, settled_at INTEGER, formations TEXT, UNIQUE (room_id, user_id, race_key) )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_entries_user ON bb_entries(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bb_entries_race ON bb_entries(race_key, status)`,
  `CREATE TABLE IF NOT EXISTS bb_tickets ( ticket_id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL REFERENCES bb_entries(entry_id), bet_type TEXT NOT NULL CHECK (bet_type IN ('3t','3f','2t')), combo TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount > 0 AND amount % 100 = 0), odds_at_submit REAL, payout INTEGER NOT NULL DEFAULT 0, result TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending','hit','miss','refund')), UNIQUE (entry_id, bet_type, combo) )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_tickets_entry ON bb_tickets(entry_id)`,
  `CREATE TABLE IF NOT EXISTS bb_race_results ( race_key TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('settled','cancelled')), order_json TEXT, payouts_json TEXT, scratched_json TEXT, fetched_at INTEGER NOT NULL )`,
  `CREATE TABLE IF NOT EXISTS bb_room_results ( room_id TEXT NOT NULL REFERENCES bb_rooms(room_id), user_id TEXT NOT NULL REFERENCES bb_users(user_id), rank INTEGER NOT NULL, stake INTEGER NOT NULL, refund INTEGER NOT NULL DEFAULT 0, payout INTEGER NOT NULL DEFAULT 0, roi REAL, PRIMARY KEY (room_id, user_id) )`,
  `CREATE TABLE IF NOT EXISTS bb_monthly_stats ( ym TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES bb_users(user_id), races INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0, stake INTEGER NOT NULL DEFAULT 0, refund INTEGER NOT NULL DEFAULT 0, payout INTEGER NOT NULL DEFAULT 0, max_payout INTEGER NOT NULL DEFAULT 0, max_payout_points INTEGER, max_payout_odds REAL, battles INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, rank INTEGER, visitors INTEGER NOT NULL DEFAULT 0, visitor_rank INTEGER, PRIMARY KEY (ym, user_id) )`,
  `CREATE TABLE IF NOT EXISTS bb_visits ( room_id TEXT NOT NULL, visitor_id TEXT NOT NULL, sharer_id TEXT NOT NULL, phase TEXT, ip_hash TEXT, day TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (room_id, visitor_id) )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_visits_sharer ON bb_visits(sharer_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_bb_visits_ip ON bb_visits(room_id, ip_hash, day)`,
  `CREATE TABLE IF NOT EXISTS bb_comments ( comment_id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES bb_rooms(room_id), user_id TEXT NOT NULL REFERENCES bb_users(user_id), body TEXT NOT NULL, created_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, hidden_by TEXT )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_comments_room ON bb_comments(room_id, comment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bb_comments_user ON bb_comments(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS bb_venue_live ( venue_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, source TEXT, updated_at INTEGER NOT NULL, updated_by TEXT )`,
  `CREATE TABLE IF NOT EXISTS bb_codes ( code_id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('bb','brain')), code TEXT NOT NULL, valid_from INTEGER NOT NULL, valid_until INTEGER NOT NULL, created_at INTEGER NOT NULL, created_by TEXT, note_url TEXT )`,
  `CREATE INDEX IF NOT EXISTS idx_bb_codes_valid ON bb_codes(valid_until)`,
  `CREATE TABLE IF NOT EXISTS bb_settings ( name TEXT PRIMARY KEY, value TEXT )`,
  `CREATE TABLE IF NOT EXISTS bb_code_fails ( ip_key TEXT NOT NULL, slot INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ip_key, slot) )`,
  `CREATE TABLE IF NOT EXISTS bb_admin_log ( id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT, note TEXT )`
];
// すでにあるデータベースに、後から足した列を追加する（[表, 列, 追加の命令]）
const COLUMNS_ADDED = [
  ['bb_races', 'cancel', 'ALTER TABLE bb_races ADD COLUMN cancel INTEGER NOT NULL DEFAULT 0'],
  ['bb_races', 'status', 'ALTER TABLE bb_races ADD COLUMN status INTEGER'],
  ['bb_entries', 'formations', 'ALTER TABLE bb_entries ADD COLUMN formations TEXT'],
  ['bb_cups', 'slot', 'ALTER TABLE bb_cups ADD COLUMN slot TEXT'],
  ['bb_cups', 'finished', 'ALTER TABLE bb_cups ADD COLUMN finished INTEGER NOT NULL DEFAULT 0'],
  ['bb_codes', 'note_url', 'ALTER TABLE bb_codes ADD COLUMN note_url TEXT'],
  ['bb_rooms', 'recruit', "ALTER TABLE bb_rooms ADD COLUMN recruit TEXT NOT NULL DEFAULT 'invite'"],
  ['bb_rooms', 'capacity', 'ALTER TABLE bb_rooms ADD COLUMN capacity INTEGER'],
];
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name LIKE 'bb_%'").first();
  if (!row || row.n < SCHEMA_TABLES) await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
  // 後から足した列が、まだない場合は追加する
  const tables = [...new Set(COLUMNS_ADDED.map((c) => c[0]))];
  for (const table of tables) {
    const cols = (await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all()).results.map((c) => c.name);
    for (const [tb, col, ddl] of COLUMNS_ADDED) {
      if (tb === table && !cols.includes(col)) await env.DB.prepare(ddl).run();
    }
  }
  schemaReady = true;
}

// ---------------------------------------------------------------------
// ルーティング
// ---------------------------------------------------------------------
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!path.startsWith(BASE + '/')) return json({ error: 'not_found' }, 404);
  const p = path.slice(BASE.length);

  // 書き込み系は、自サイトからの要求だけを受け付ける
  if (method !== 'GET' && method !== 'HEAD') {
    if (request.headers.get('Origin') !== env.SITE_ORIGIN) return json({ error: 'bad_origin' }, 403);
  }

  if (method === 'GET' && p === '/auth/login') return authLogin(url, env);
  if (method === 'GET' && p === '/auth/callback') return authCallback(url, env);
  if (method === 'POST' && p === '/auth/logout') return authLogout(request, env);

  const sm = p.match(/^\/s\/([A-Za-z0-9]{6,24})$/);
  if (method === 'GET' && sm) return sharePage(url, env, sm[1]);
  if (method === 'GET' && p === '/api/live') return apiLive(env);
  if (p === '/api/premium') return method === 'POST' ? apiPremiumEnter(request, env) : apiPremiumStatus(request, env);
  if (method === 'GET' && p === '/api/stats') return apiStats(request, env, url);
  const um = p.match(/^\/api\/users\/([A-Za-z0-9]{16})$/);
  if (method === 'GET' && um) return apiUserCard(request, env, um[1]);
  if (method === 'GET' && p === '/api/cups') return apiCups(url, env);
  if (method === 'GET' && p === '/api/races') return apiRaces(url, env);
  if (method === 'GET' && p === '/api/racecard') return apiRacecard(url, env);
  if (method === 'GET' && p === '/api/me') return apiMe(request, env);
  if (method === 'POST' && p === '/api/me/name') return apiSetName(request, env);
  if (method === 'POST' && p === '/api/rooms') return apiCreateRoom(request, env);
  if (method === 'GET' && p === '/api/rooms') return apiListRooms(env);

  if (p.startsWith('/api/admin/')) return adminRoute(request, env, url, p.slice('/api/admin/'.length), method);
  const rf = p.match(/^\/api\/rooms\/([A-Za-z0-9]{6,24})\/races\/(\d{8}-[a-z0-9_]{1,24}-\d{1,2})\/refresh$/);
  if (rf && method === 'POST') return apiRefreshRace(env, rf[1], rf[2]);
  const cm = p.match(/^\/api\/rooms\/([A-Za-z0-9]{6,24})\/comments(?:\/(\d{1,12})\/hide)?$/);
  if (cm && method === 'POST') return cm[2] ? apiHideComment(request, env, cm[1], Number(cm[2])) : apiPostComment(request, env, cm[1]);
  const m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{6,24})(\/join|\/decline|\/visit|\/entries|\/delete)?$/);
  if (m) {
    if (method === 'GET' && !m[2]) return apiGetRoom(request, env, m[1]);
    if (method === 'POST' && m[2] === '/join') return apiRespond(request, env, m[1], true);
    if (method === 'POST' && m[2] === '/decline') return apiRespond(request, env, m[1], false);
    if (method === 'POST' && m[2] === '/visit') return apiVisit(request, env, m[1]);
    if (method === 'POST' && m[2] === '/entries') return apiSubmitEntry(request, env, m[1]);
    if (method === 'POST' && m[2] === '/delete') return apiDeleteRoom(request, env, m[1]);
  }
  return json({ error: 'not_found' }, 404);
}

// ---------------------------------------------------------------------
// 共通の小道具
// ---------------------------------------------------------------------
const now = () => Math.floor(Date.now() / 1000);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...headers },   // 検索の対象外
  });
}

function redirect(location, headers = {}) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });
}

// 推測できないランダムな文字列（英数字）
function rid(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const limit = 256 - (256 % chars.length);      // 偏りを避けるため、範囲外の値は捨てる
  let out = '';
  while (out.length < len) {
    const buf = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of buf) {
      if (b < limit && out.length < len) out += chars[b % chars.length];
    }
  }
  return out;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256b64url(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64url(new Uint8Array(digest));
}

// 日本時間の日付 YYYY-MM-DD
function jstDate(ts) {
  return new Date((ts + 9 * 3600) * 1000).toISOString().slice(0, 10);
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=${BASE}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === 'object' ? b : null;
  } catch (e) {
    return null;
  }
}

// ログイン中の予想屋を返す（未ログインは null）
async function currentUser(request, env) {
  const sid = readCookie(request, COOKIE);
  if (!sid || !/^[A-Za-z0-9]{20,64}$/.test(sid)) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM bb_sessions s JOIN bb_users u ON u.user_id = s.user_id
      WHERE s.session_id = ? AND s.expires_at > ?`
  ).bind(sid, now()).first();
  if (!row || row.status === 'deleted') return null;
  return row;
}

// 画面に出してよい予想屋の情報だけを取り出す
function publicUser(u) {
  return {
    user_id: u.user_id,
    handle: u.handle,              // 削除済みは null
    display_name: u.display_name,  // 削除済みは null（画面側で「削除済みユーザー」と表示）
    icon_url: u.icon_url,
  };
}

// 表示名の整形：制御文字と前後の空白を除き、長さを制限
function cleanName(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '').trim();
  if (!t) return null;
  return [...t].slice(0, NAME_MAX).join('');
}

// ---------------------------------------------------------------------
// Xログイン
// ---------------------------------------------------------------------
const xAuthUrl = (env) => env.X_AUTH_URL || 'https://x.com/i/oauth2/authorize';
const xApiBase = (env) => env.X_API_BASE || 'https://api.x.com';
const callbackUrl = (env) => env.SITE_ORIGIN + BASE + '/auth/callback';

// ログイン後に戻す先は、自サイト内のパスだけを許可
function safeReturn(v) {
  if (typeof v === 'string' && /^\/[A-Za-z0-9_\-./?=&%]*$/.test(v) && !v.startsWith('//')) return v;
  return '/';
}

async function authLogin(url, env) {
  const state = rid(32);
  const verifier = rid(64);
  const challenge = await sha256b64url(verifier);
  const t = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bb_oauth_states WHERE created_at < ?').bind(t - 600),
    env.DB.prepare('INSERT INTO bb_oauth_states (state, code_verifier, return_to, created_at) VALUES (?,?,?,?)')
      .bind(state, verifier, safeReturn(url.searchParams.get('return')), t),
  ]);
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: env.X_CLIENT_ID,
    redirect_uri: callbackUrl(env),
    scope: 'tweet.read users.read',       // 読み取りのみ。投稿の権限は求めない
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return redirect(xAuthUrl(env) + '?' + q.toString());
}

async function authCallback(url, env) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const fail = (reason) => redirect(env.SITE_ORIGIN + '/?login=' + reason);
  if (!code || !state) return fail('cancelled');

  const st = await env.DB.prepare('SELECT * FROM bb_oauth_states WHERE state = ?').bind(state).first();
  if (!st || st.created_at < now() - 600) return fail('expired');
  await env.DB.prepare('DELETE FROM bb_oauth_states WHERE state = ?').bind(state).run();

  // 認可コードをアクセストークンに交換
  const tokenRes = await fetch(xApiBase(env) + '/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(env.X_CLIENT_ID + ':' + env.X_CLIENT_SECRET),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(env),
      code_verifier: st.code_verifier,
      client_id: env.X_CLIENT_ID,
    }).toString(),
  });
  if (!tokenRes.ok) return fail('token');
  const token = await tokenRes.json().catch(() => null);
  if (!token || !token.access_token) return fail('token');

  // 本人の情報を取得（アクセストークンはここで使うだけで、保存しない）
  const meRes = await fetch(xApiBase(env) + '/2/users/me?user.fields=profile_image_url', {
    headers: { Authorization: 'Bearer ' + token.access_token },
  });
  if (!meRes.ok) return fail('profile');
  const me = (await meRes.json().catch(() => null))?.data;
  if (!me || !me.id || !me.username) return fail('profile');

  const t = now();
  const handle = String(me.username);
  const icon = typeof me.profile_image_url === 'string' ? me.profile_image_url : null;
  let user = await env.DB.prepare('SELECT * FROM bb_users WHERE x_user_id = ?').bind(String(me.id)).first();
  // Xの名前は、ログインのたびに最新のものへ更新する（自分で決めた表示名は変えない）
  const xName = cleanName(me.name) || handle;
  if (user) {
    await env.DB.prepare('UPDATE bb_users SET handle = ?, x_name = ?, icon_url = ?, last_login_at = ? WHERE user_id = ?')
      .bind(handle, xName, icon, t, user.user_id).run();
  } else {
    const userId = rid(16);
    await env.DB.prepare(
      `INSERT INTO bb_users (user_id, x_user_id, handle, x_name, display_name, icon_url, status, created_at, last_login_at)
       VALUES (?,?,?,?,?,?,'active',?,?)`
    ).bind(userId, String(me.id), handle, xName, xName, icon, t, t).run();
    user = { user_id: userId };
  }

  // 自分の@ID宛ての未応答の招待を、この予想屋に結びつける
  await env.DB.prepare(
    `UPDATE bb_invites SET user_id = ? WHERE handle = ? AND status = 'pending' AND user_id IS NULL`
  ).bind(user.user_id, handle.toLowerCase()).run();

  const sid = rid(40);
  const maxAge = SESSION_DAYS * 86400;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM bb_sessions WHERE expires_at < ?').bind(t),
    env.DB.prepare('INSERT INTO bb_sessions (session_id, user_id, created_at, expires_at) VALUES (?,?,?,?)')
      .bind(sid, user.user_id, t, t + maxAge),
  ]);
  return redirect(env.SITE_ORIGIN + st.return_to, { 'Set-Cookie': sessionCookie(sid, maxAge) });
}

async function authLogout(request, env) {
  const sid = readCookie(request, COOKIE);
  if (sid) await env.DB.prepare('DELETE FROM bb_sessions WHERE session_id = ?').bind(sid).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

// ---------------------------------------------------------------------
// 開催とレース（発走・締切）の取得
//   取得元（2026-10-04 に本番の実データで確認）
//     開催の一覧 : WinTicketの開催一覧のページ。「本日開催」「明日開催」のパネルの中のリンク
//     レース     : WinTicketの開催ごとのJSON。schedules（日付ごと）と races（number・startAt・closeAt・cancel・status）
//   取りに行く回数を抑えるため、結果をデータベースに持ち、一定時間は使い回す。
//   端末から送られてきた締切時刻は使わない。締切の判断は、ここで持っている値で行う。
// ---------------------------------------------------------------------
const CUPS_TTL = 600;      // 開催の一覧を使い回す秒数
const RACES_TTL = 180;     // レース情報を使い回す秒数（設定 RACES_TTL で変更できる）
const racesTtl = (env) => Number(env.RACES_TTL) || RACES_TTL;

// 開催日として受け付けるのは、当日と翌日（日本時間）
const allowedDates = (t) => [jstDate(t), jstDate(t + 86400)];

async function refreshCups(env) {
  const t = now();
  const top = await fetchSource(srcWeb(env) + '/keirin');
  if (!top.ok || !top.text) return false;
  const sets = [[jstDate(t), panelLinks(top.text, 'today')], [jstDate(t + 86400), panelLinks(top.text, 'tomorrow')]];
  const stmts = [];
  for (const [date, links] of sets) {
    if (links === null) continue;                       // パネルが見つからない日は、持っている内容を変えない
    stmts.push(env.DB.prepare('DELETE FROM bb_cups WHERE race_date = ?').bind(date));
    // 「この日の分を取得した」という印（開催が1つもない日でも、取り直しを繰り返さないため）
    stmts.push(env.DB.prepare(`INSERT INTO bb_cups (race_date, venue_id, cup_code, day_num, fetched_at) VALUES (?, '_', '', NULL, ?)`).bind(date, t));
    for (const l of links) {
      if (!VENUE_IDS.has(l.venue)) continue;
      stmts.push(env.DB.prepare(
        'INSERT OR REPLACE INTO bb_cups (race_date, venue_id, cup_code, day_num, fetched_at, slot, finished) VALUES (?,?,?,?,?,?,?)'
      ).bind(date, l.venue, l.cup, Number(l.day) || 1, t, l.slot || 'day', l.type === 'raceresult' ? 1 : 0));
    }
  }
  if (stmts.length === 0) return false;
  await env.DB.batch(stmts);
  return true;
}

// その日に開催がある競輪場の一覧。stale = 取り直しに失敗して、古い内容を返している
async function loadCups(env, date) {
  const read = async () => (await env.DB.prepare('SELECT * FROM bb_cups WHERE race_date = ? ORDER BY rowid').bind(date).all()).results;      // 取得元の並び順のまま
  let rows = await read();
  let stale = false;
  const mark = rows.find((r) => r.venue_id === '_');
  if (!mark || mark.fetched_at <= now() - CUPS_TTL) {
    const ok = await refreshCups(env);
    rows = await read();
    stale = !ok;
  }
  return { cups: rows.filter((r) => r.venue_id !== '_'), stale, known: rows.some((r) => r.venue_id === '_') };
}

// その日・その競輪場のレース一覧。reason は、取れなかったときの理由
async function loadRaces(env, date, venue) {
  const t = now();
  const read = async () => (await env.DB.prepare(
    'SELECT race_key, race_num, start_at, deadline_at, cancel, status, fetched_at, cup_code, day_num FROM bb_races WHERE race_date = ? AND venue_id = ? ORDER BY race_num'
  ).bind(date, venue).all()).results;
  let rows = await read();
  if (rows.length && rows.every((r) => r.fetched_at > t - racesTtl(env))) return { races: rows };

  const { cups } = await loadCups(env, date);
  const cup = cups.find((c) => c.venue_id === venue);
  if (!cup) return { races: [], reason: 'no_cup' };

  const api = await fetchSource(`${srcApi(env)}/v1/keirin/cups/${cup.cup_code}?pfm=web`);
  let j = null;
  if (api.ok) { try { j = JSON.parse(api.text); } catch (e) { j = null; } }
  if (!j || !Array.isArray(j.schedules) || !Array.isArray(j.races)) {
    return rows.length ? { races: rows, stale: true } : { races: [], reason: 'fetch_failed' };
  }
  // 日付で該当日を選ぶ（リンクに書かれた「何日目」ではなく、取得元の日付を正とする）
  const ymd = date.replace(/-/g, '');
  const sch = j.schedules.find((s) => String(s.date) === ymd);
  if (!sch) return { races: [], reason: 'no_schedule' };
  const list = j.races.filter((r) => r.scheduleId === sch.id && Number.isInteger(r.number) && r.number >= 1 && r.number <= 12);
  if (list.length === 0) return { races: [], reason: 'no_races' };
  const venueName = (j.venue && typeof j.venue.name === 'string' && j.venue.name) || venue;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null);
  await env.DB.batch(list.map((r) => env.DB.prepare(
    `INSERT INTO bb_races (race_key, race_date, venue_id, venue_name, race_num, cup_code, day_num, start_at, deadline_at, fetched_at, cancel, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(race_key) DO UPDATE SET start_at = excluded.start_at, deadline_at = excluded.deadline_at,
       fetched_at = excluded.fetched_at, cancel = excluded.cancel, status = excluded.status, cup_code = excluded.cup_code, day_num = excluded.day_num`
  ).bind(`${ymd}-${venue}-${r.number}`, date, venue, venueName, r.number, cup.cup_code, num(sch.day), num(r.startAt), num(r.closeAt), t, r.cancel ? 1 : 0, num(r.status))));
  rows = await read();
  return { races: rows };
}

function publicRace(r, t) {
  return {
    race_key: r.race_key, race_num: r.race_num, start_at: r.start_at, deadline_at: r.deadline_at,
    cancel: !!r.cancel, closed: !r.deadline_at || r.deadline_at <= t,
  };
}

async function apiCups(url, env) {
  const date = url.searchParams.get('date') || '';
  if (!allowedDates(now()).includes(date)) return json({ error: 'invalid', field: 'date' }, 400);
  const r = await loadCups(env, date);
  // 選べるレースが残っているか：取得元でその日の開催が終わっている、または、持っているレース情報で最後の締切を過ぎている
  const t = now();
  const last = new Map((await env.DB.prepare(
    'SELECT venue_id, MAX(deadline_at) AS last FROM bb_races WHERE race_date = ? AND cancel = 0 GROUP BY venue_id'
  ).bind(date).all()).results.map((x) => [x.venue_id, x.last]));
  const order = { morning: 0, day: 1, nighter: 2, midnight: 3 };
  const cups = r.cups.map((c) => ({
    venue_id: c.venue_id, day_num: c.day_num, slot: order[c.slot] !== undefined ? c.slot : 'day',
    closed: !!c.finished || (last.has(c.venue_id) && last.get(c.venue_id) !== null && last.get(c.venue_id) <= t),
  }));
  // 並びは、モーニング → デイ → ナイター → ミッドナイト。同じ時間帯の中は、取得元の順
  cups.sort((a, b) => order[a.slot] - order[b.slot]);
  return json({ date, cups, stale: r.stale, known: r.known });
}

async function apiRaces(url, env) {
  const date = url.searchParams.get('date') || '';
  const venue = url.searchParams.get('venue') || '';
  const t = now();
  if (!allowedDates(t).includes(date)) return json({ error: 'invalid', field: 'date' }, 400);
  if (!VENUE_IDS.has(venue)) return json({ error: 'invalid', field: 'venue' }, 400);
  const r = await loadRaces(env, date, venue);
  return json({ date, venue_id: venue, races: r.races.map((x) => publicRace(x, t)), reason: r.reason || null, stale: !!r.stale });
}

// ---------------------------------------------------------------------
// 1レース分の情報（出走表・並び予想・オッズ）
//   取得元（2026-10-04 に本番の実データで確認）：WinTicketの1レース分のJSON。fields で必要な項目だけを取る
//     出走表 : race, entries（車番・欠場・選手ID）, players（選手名・府県・期・級班）
//     オッズ : trifecta（3連単）, trio（3連複）, exacta（2車単）。key が車番の並び、odds が倍率
//   取りに行く回数を抑えるため、短い時間だけ使い回す（出走表120秒、オッズ20秒）
// ---------------------------------------------------------------------
const RACECARD_TTL = 120;
const ODDS_TTL = 20;
const BET_FIELD = { '3t': 'trifecta', '3f': 'trio', '2t': 'exacta' };
const BET_CARS = { '3t': 3, '3f': 3, '2t': 2 };

// 取得した本文を、指定した秒数だけ使い回す
async function cachedSource(url, ttl) {
  const cache = caches.default;
  const key = new Request(url);
  const hit = await cache.match(key);
  if (hit) return hit.text();
  const res = await fetchSource(url);
  if (!res.ok || !res.text) return null;
  await cache.put(key, new Response(res.text, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` } }));
  return res.text;
}

// レースの指定（YYYYMMDD-競輪場ID-番号）から、サーバーが持っているレース情報を引く
async function raceRef(env, raceKey) {
  if (!RACE_KEY_RE.test(raceKey)) return null;
  const [ymd, venue, numStr] = raceKey.split('-');
  if (!VENUE_IDS.has(venue)) return null;
  const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  const info = await loadRaces(env, date, venue);
  const row = info.races.find((r) => r.race_key === raceKey);
  if (!row) return null;
  return { row, date, venue, num: Number(numStr) };
}
const raceApiUrl = (env, ref, fields) =>
  `${srcApi(env)}/v1/keirin/cups/${ref.row.cup_code}/schedules/${ref.row.day_num}/races/${ref.num}?fields=${fields}&pfm=web`;

// 並び予想を、ラインごとの車番の並びに直す（例 [[1,5],[2,6],[8,7,3],[4,9]]）
//   取得元の形（2026-10-04 に本番の実データで確認）：
//     { lineType: '四分戦', lines: [ { entries: [ { numbers: [1] }, { numbers: [5] } ] }, … ] }
//   entries がラインの先頭からの並び。numbers は、その位置の車番（1つの位置に複数入ることがある形なので、順にそのまま並べる）
//   形が違って読めないときは null（画面には出さない）
function parseLines(lp) {
  if (!lp || !Array.isArray(lp.lines)) return null;
  const isCar = (n) => Number.isInteger(n) && n >= 1 && n <= 9;
  const out = [];
  for (const line of lp.lines) {
    if (!line || !Array.isArray(line.entries)) return null;
    const nums = [];
    for (const e of line.entries) {
      if (!e || !Array.isArray(e.numbers) || !e.numbers.every(isCar)) return null;
      nums.push(...e.numbers);
    }
    if (nums.length) out.push(nums);
  }
  const flat = out.flat();
  if (flat.length === 0 || new Set(flat).size !== flat.length) return null;
  return out;
}

// 級班の表示（2026-10-04 に本番の実データで確認）
//   class 1 = S級、2 = A級、4 = L級（ガールズ）。group は班（確認できたのは S級2班、A級1〜3班、L級1班）
//   確認できていない番号は、級の文字だけ、または表示なしにする
function classLabel(cls, group) {
  const letter = { 1: 'S', 2: 'A', 4: 'L' }[cls];
  if (!letter) return null;
  return Number.isInteger(group) && group >= 1 && group <= 3 ? letter + group : letter;
}

// 出走表。取れなかったときは null
async function getRacecard(env, ref) {
  const text = await cachedSource(raceApiUrl(env, ref, 'race,entries,players'), RACECARD_TTL);
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
  if (!j || !Array.isArray(j.entries) || !Array.isArray(j.players) || j.entries.length === 0) return null;
  const players = new Map(j.players.map((pl) => [pl.id, pl]));
  const cars = j.entries
    .filter((e) => Number.isInteger(e.number) && e.number >= 1 && e.number <= 9)
    .map((e) => {
      const pl = players.get(e.playerId) || {};
      return {
        number: e.number,
        absent: !!e.absent,
        name: typeof pl.name === 'string' ? pl.name : '',
        prefecture: typeof pl.prefecture === 'string' ? pl.prefecture : '',
        term: Number.isInteger(pl.term) ? pl.term : null,
        cls: classLabel(pl.class, pl.group),
      };
    })
    .sort((a, b) => a.number - b.number);
  // 並び予想は、別に取りに行く（取れなくても出走表は返す）
  let line = null, lineType = null;
  const lt = await cachedSource(raceApiUrl(env, ref, 'linePrediction'), RACECARD_TTL);
  try {
    const lj = lt ? JSON.parse(lt) : null;
    if (lj && lj.linePrediction) { line = parseLines(lj.linePrediction); lineType = typeof lj.linePrediction.lineType === 'string' ? lj.linePrediction.lineType : null; }
  } catch (e) { line = null; }
  return { cars, line, line_type: line ? lineType : null };
}

// オッズ。{ '4-2-6': 12.4, … } の形。取れなかったときは null
async function getOdds(env, ref, bet) {
  const field = BET_FIELD[bet];
  if (!field) return null;
  const text = await cachedSource(raceApiUrl(env, ref, field), ODDS_TTL);
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
  const arr = j && j[field];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const odds = {};
  for (const o of arr) {
    if (!o || !Array.isArray(o.key) || o.key.length !== BET_CARS[bet] || o.absent) continue;
    if (typeof o.odds !== 'number' || !(o.odds > 0)) continue;
    const cars = bet === '3f' ? o.key.slice().sort((a, b) => a - b) : o.key;
    odds[cars.join('-')] = o.odds;
  }
  return Object.keys(odds).length ? odds : null;
}

async function apiRacecard(url, env) {
  const key = url.searchParams.get('key') || '';
  const bet = url.searchParams.get('bet') || '';
  if (!BET_TYPES.includes(bet)) return json({ error: 'invalid', field: 'bet' }, 400);
  const ref = await raceRef(env, key);
  if (!ref || !allowedDates(now()).includes(ref.date)) return json({ error: 'not_found' }, 404);
  const [card, odds] = await Promise.all([getRacecard(env, ref), getOdds(env, ref, bet)]);
  if (!card) return json({ error: 'source_unavailable' }, 503);
  return json({
    race: publicRace(ref.row, now()), venue_id: ref.venue, bet,
    cars: card.cars, line: card.line, line_type: card.line_type,
    odds: odds || {}, odds_ok: !!odds,
  });
}

// ---------------------------------------------------------------------
// 買い目の投稿
//   1人が、1つのバトルルームの1レースに投稿できるのは1回だけ。訂正・取り消しはない。
//   締切・金額・賭け式・車番は、すべてここ（サーバー側）で確かめる。端末の計算は信用しない。
// ---------------------------------------------------------------------
async function apiSubmitEntry(request, env, roomId) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'login_required' }, 401);
  if (user.status !== 'active') return json({ error: 'suspended' }, 403);
  const room = await loadRoom(env, roomId);
  if (!room) return json({ error: 'not_found' }, 404);
  if (room.state !== 'open') return json({ error: 'not_open' }, 409);
  const member = await env.DB.prepare('SELECT 1 AS ok FROM bb_members WHERE room_id = ? AND user_id = ?').bind(roomId, user.user_id).first();
  if (!member) return json({ error: 'not_member' }, 403);

  const b = await readBody(request);
  if (!b) return json({ error: 'invalid_body' }, 400);
  const bad = (field, reason) => json({ error: 'invalid', field, reason: reason || null }, 400);
  const raceKey = String(b.race_key || '');
  const bet = room.bet_types.split(',')[0];
  const need = BET_CARS[bet];
  const t = now();

  // このバトルルームで投票できるレースか
  const mine = (await env.DB.prepare('SELECT race_key FROM bb_entries WHERE room_id = ? AND user_id = ?').bind(roomId, user.user_id).all()).results.map((r) => r.race_key);
  if (mine.includes(raceKey)) return json({ error: 'already_voted' }, 409);
  if (room.mode === 'fixed') {
    const inRoom = await env.DB.prepare('SELECT 1 AS ok FROM bb_room_races WHERE room_id = ? AND race_key = ?').bind(roomId, raceKey).first();
    if (!inRoom) return bad('race_key', 'not_in_room');
  } else {
    if (!validRaceKey(raceKey, room.battle_date.replace(/-/g, ''))) return bad('race_key', 'wrong_date');
    if (mine.length >= room.race_count) return json({ error: 'no_races_left' }, 409);
  }

  // レースの状態（サーバーが持っている締切で判断する）
  const ref = await raceRef(env, raceKey);
  if (!ref) return bad('race_key', 'not_found');
  if (ref.row.cancel) return json({ error: 'race_cancelled' }, 409);
  if (!ref.row.deadline_at || t >= ref.row.deadline_at) return json({ error: 'deadline_passed' }, 409);

  // 出走表（車番と欠場）
  const card = await getRacecard(env, ref);
  if (!card) return json({ error: 'source_unavailable' }, 503);
  const runners = new Set(card.cars.filter((c) => !c.absent).map((c) => c.number));

  // 買い目：点数、車番、重複、金額（100円単位）、合計（ちょうど固定額）
  const list = Array.isArray(b.tickets) ? b.tickets : [];
  if (list.length < 1 || list.length > room.stake / 100) return bad('tickets', 'count');
  const seen = new Set();
  const tickets = [];
  let sum = 0;
  for (const tk of list) {
    const parts = String((tk && tk.combo) || '').split('-');
    if (parts.length !== need || parts.some((x) => !/^[1-9]$/.test(x))) return bad('tickets', 'combo');
    let cars = parts.map(Number);
    if (new Set(cars).size !== need || cars.some((n) => !runners.has(n))) return bad('tickets', 'combo');
    if (bet === '3f') cars = cars.slice().sort((x, y) => x - y);
    const combo = cars.join('-');
    if (seen.has(combo)) return bad('tickets', 'duplicate');
    seen.add(combo);
    const amount = Number(tk.amount);
    if (!Number.isInteger(amount) || amount < 100 || amount % 100 !== 0) return bad('tickets', 'amount');
    sum += amount;
    tickets.push({ combo, amount });
  }
  if (sum !== room.stake) return bad('tickets', 'total');

  // フォーメーション（入力した形。例 4-26-1267）。展開した結果が、買い目の一覧とちょうど一致することを確かめる
  const forms = Array.isArray(b.formations) ? b.formations : [];
  if (forms.length < 1 || forms.length > 30) return bad('formations', 'count');
  const formTexts = [];
  const expanded = new Set();
  for (const f of forms) {
    const cols = String(f || '').split('-');
    if (cols.length !== need || cols.some((c) => !/^[1-9]{1,9}$/.test(c))) return bad('formations', 'format');
    const lists = cols.map((c) => [...new Set(c.split('').map(Number))].sort((x, y) => x - y));
    if (lists.some((l, i) => l.length !== cols[i].length || l.some((n) => !runners.has(n)))) return bad('formations', 'format');
    const text = lists.map((l) => l.join('')).join('-');
    if (formTexts.includes(text)) return bad('formations', 'duplicate');
    formTexts.push(text);
    const walk = (i, cur) => {
      if (i === need) { expanded.add((bet === '3f' ? cur.slice().sort((x, y) => x - y) : cur).join('-')); return; }
      for (const n of lists[i]) if (!cur.includes(n)) walk(i + 1, cur.concat(n));
    };
    walk(0, []);
  }
  if (expanded.size !== seen.size || [...expanded].some((c) => !seen.has(c))) return bad('formations', 'mismatch');

  // 投稿時のオッズ（参考として保存。取れなければ空）
  const odds = (await getOdds(env, ref, bet)) || {};
  const entryId = rid(16);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO bb_entries (entry_id, room_id, user_id, race_key, status, stake, ticket_count, submitted_at, formations)
         VALUES (?,?,?,?,'submitted',?,?,?,?)`
      ).bind(entryId, roomId, user.user_id, raceKey, room.stake, tickets.length, t, JSON.stringify(formTexts)),
      ...tickets.map((tk) => env.DB.prepare(
        'INSERT INTO bb_tickets (entry_id, bet_type, combo, amount, odds_at_submit) VALUES (?,?,?,?,?)'
      ).bind(entryId, bet, tk.combo, tk.amount, typeof odds[tk.combo] === 'number' ? odds[tk.combo] : null)),
    ]);
  } catch (e) {
    // 同じレースへの2回目の投稿は、データベースの制約で拒否される
    if (String(e && e.message).includes('UNIQUE')) return json({ error: 'already_voted' }, 409);
    throw e;
  }
  return json({ ok: true, race_key: raceKey, ticket_count: tickets.length }, 201);
}

// ---------------------------------------------------------------------
// 結果の取得、的中・返還の判定、バトルルームの終了
//   取得元（2026-10-04 に本番の実データで確認）：WinTicketの1レース分のJSON
//     race.status   … 1＝締切前、2＝締切後で結果確定前、3＝結果確定
//     race.cancel   … 中止
//     entries[].absent … 欠場
//     results[]     … 着順（order と選手ID）
//     {賭け式}WinningOddsIds … 的中した組み合わせのID（同着のときは複数）
//     {賭け式}[].payoffUnitPrice … 的中した組み合わせの、100円あたりの払戻金
//   判定のルール
//     的中   ：買い目が的中した組み合わせに含まれる → 払戻 = 金額 ÷ 100 × 100円あたりの払戻金
//     返還   ：中止のレースは全額。欠場の車を含む買い目は、その買い目の金額
//     未投票 ：指定レースに投票しなかった人は、そのレースの固定額を投資して払戻0（中止のレースは数えない）
//     回収率 ：払戻 ÷（投資 − 返還）× 100
//   実データで確認できていないもの：欠場・中止・同着のレース。取得元の項目の意味に沿って作ってある
//   対応していないもの：的中者がいないときの特別な払戻（特払い）。その賭け式の結果は確定待ちのままになる
// ---------------------------------------------------------------------
const RESULT_TTL = 30;      // 結果の確認で、取得元から取った内容を使い回す秒数（設定 RESULT_TTL で変更できる）
const LAZY_GAP = 20;        // 閲覧時のついで実行の間隔（秒）
let lastLazy = 0;
// 1回の実行で進める量の上限。無料プランでは、1回の実行で使えるデータベースの問い合わせが50回までのため、小分けにして進める。
// 残りは次の実行（2分ごとの定期実行と、閲覧時のついで実行）で続きから進む。有料プランに切り替えたら増やせる
const TICK_RACES = 2;       // 結果を確かめるレースの数
const TICK_ENTRIES = 6;     // 判定する投稿の数
const TICK_ROOMS = 2;       // 終了させるバトルルームの数

// レース1つの結果を確かめ、確定していれば保存して、そのレースの買い目を判定する
//   戻り値：{ status: 'settled'（確定）／'cancelled'（中止）／'pending'（まだ）, reason: まだのときの理由 }
//   取得するのは、そのレースで実際に使われている賭け式の分だけ（3連単は組み合わせが多く、取得する量が大きいため）。
//   レースの情報（開催コード・何日目）は、持っているものをそのまま使う（ここでは開催の一覧を取り直さない）。
async function neededBets(env, raceKey) {
  const rows = (await env.DB.prepare(
    `SELECT DISTINCT t.bet_type AS bet FROM bb_tickets t JOIN bb_entries e ON e.entry_id = t.entry_id WHERE e.race_key = ?1 AND e.status = 'submitted'
     UNION
     SELECT DISTINCT ro.bet_types AS bet FROM bb_room_races rr JOIN bb_rooms ro ON ro.room_id = rr.room_id WHERE rr.race_key = ?1 AND ro.state = 'open' AND ro.hidden = 0`
  ).bind(raceKey).all()).results;
  const set = new Set();
  rows.forEach((r) => String(r.bet || '').split(',').forEach((b) => { if (BET_TYPES.includes(b)) set.add(b); }));
  return [...set];
}
// 取得元から、着順と、指定した賭け式の的中・払戻を読む
//   着順は、(1) 着順の一覧（results）から読む。(2) それが空なら、的中した2車単（1着-2着）と3連複（上位3車）から、
//   1〜3着を組み立てる。2車単と3連複は組み合わせの数が少ないので、いつも一緒に取得する。
async function fetchResult(env, row, bets) {
  const want = [...new Set([...bets, '2t', '3f'])];
  const fields = ['race', 'entries', 'results', ...want.flatMap((b) => [BET_FIELD[b], BET_FIELD[b] + 'WinningOddsIds'])].join(',');
  const url = `${srcApi(env)}/v1/keirin/cups/${row.cup_code}/schedules/${row.day_num}/races/${row.race_num}?fields=${fields}&pfm=web`;
  const text = await cachedSource(url, Number(env.RESULT_TTL) || RESULT_TTL);
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
  if (!j || !j.race) return { ok: false, reason: 'fetch_failed' };
  const scratched = (j.entries || []).filter((e) => e && e.absent && Number.isInteger(e.number)).map((e) => e.number);
  if (j.race.cancel) return { ok: true, cancelled: true, scratched };
  if (j.race.status !== 3) return { ok: false, reason: 'not_finished', race_status: j.race.status };
  // 的中した組み合わせ（賭け式ごと）。そろっていない賭け式は null
  const winsOf = (bet) => {
    const field = BET_FIELD[bet];
    const ids = j[field + 'WinningOddsIds'];
    if (!Array.isArray(ids) || ids.length === 0) return null;
    const wins = (j[field] || []).filter((x) => x && ids.includes(x.id));
    return wins.length === ids.length ? wins : null;
  };
  const payouts = {};
  for (const bet of bets) {
    const wins = winsOf(bet);
    if (!wins) return { ok: false, reason: 'no_winning_' + bet };
    payouts[bet] = {};
    for (const x of wins) {
      if (!Array.isArray(x.key) || x.key.length !== BET_CARS[bet] || !(x.payoffUnitPrice > 0)) return { ok: false, reason: 'no_payoff_' + bet };
      const cars = bet === '3f' ? x.key.slice().sort((a, b) => a - b) : x.key;
      payouts[bet][cars.join('-')] = Math.floor(x.payoffUnitPrice);
    }
  }
  // 着順 (1)：着順の一覧から（車番つき）。着順のない選手（落車・失格など）は入れない
  const carOf = new Map((j.entries || []).map((e) => [e.playerId, e.number]));
  let order = (j.results || [])
    .filter((x) => x && Number.isInteger(x.order) && x.order >= 1 && Number.isInteger(carOf.get(x.playerId)))
    .sort((a, b) => a.order - b.order || (a.index || 0) - (b.index || 0))
    .map((x) => ({ order: x.order, number: carOf.get(x.playerId) }));
  let orderSource = order.length ? 'results' : null;
  // 着順 (2)：的中した2車単（1着-2着）と3連複（上位3車）から、1〜3着を組み立てる
  if (order.length === 0) {
    const ex = winsOf('2t'), tr = winsOf('3f');
    const top2 = ex && ex[0] && Array.isArray(ex[0].key) && ex[0].key.length === 2 ? ex[0].key : null;
    if (top2) {
      order = [{ order: 1, number: top2[0] }, { order: 2, number: top2[1] }];
      const set3 = tr && tr.map((x) => x.key).find((k) => Array.isArray(k) && k.length === 3 && k.includes(top2[0]) && k.includes(top2[1]));
      const third = set3 ? set3.find((n) => n !== top2[0] && n !== top2[1]) : undefined;
      if (Number.isInteger(third)) order.push({ order: 3, number: third });
      orderSource = 'odds';
    }
  }
  return { ok: true, cancelled: false, scratched, payouts, order, order_source: orderSource };
}

// 結果は保存済みだが、着順が空のレースについて、着順だけを取り直して保存する
async function refreshOrder(env, raceKey) {
  const res = await env.DB.prepare('SELECT status, order_json FROM bb_race_results WHERE race_key = ?').bind(raceKey).first();
  if (!res || res.status !== 'settled') return { status: res ? res.status : 'pending', order: 0 };
  let cur = [];
  try { cur = JSON.parse(res.order_json || '[]'); } catch (e) { cur = []; }
  if (cur.length >= 3) return { status: 'settled', order: cur.length };
  const row = await env.DB.prepare('SELECT race_key, cup_code, day_num, race_num FROM bb_races WHERE race_key = ?').bind(raceKey).first();
  if (!row || !row.cup_code) return { status: 'settled', order: cur.length, reason: 'race_unknown' };
  const r = await fetchResult(env, row, []);
  if (!r.ok || r.cancelled) return { status: 'settled', order: cur.length, reason: r.reason || 'cancelled' };
  if (r.order.length > cur.length) {
    await env.DB.prepare('UPDATE bb_race_results SET order_json = ? WHERE race_key = ?').bind(JSON.stringify(r.order), raceKey).run();
    return { status: 'settled', order: r.order.length, order_source: r.order_source };
  }
  return { status: 'settled', order: cur.length, reason: 'no_order' };
}

async function settleRace(env, raceKey, quota) {
  const done = await env.DB.prepare('SELECT status FROM bb_race_results WHERE race_key = ?').bind(raceKey).first();
  if (done) { await settleEntries(env, raceKey, quota); return { status: done.status }; }
  const row = await env.DB.prepare('SELECT race_key, cup_code, day_num, race_num FROM bb_races WHERE race_key = ?').bind(raceKey).first();
  if (!row || !row.cup_code || !row.day_num) return { status: 'pending', reason: 'race_unknown' };
  let bets = await neededBets(env, raceKey);
  if (bets.length === 0) bets = ['2t'];                 // 誰も投票していないレースでも、着順は取る（取得量のいちばん小さい賭け式で）
  const r = await fetchResult(env, row, bets);
  if (!r.ok) return { status: 'pending', reason: r.reason, race_status: r.race_status };
  const t = now();
  // 着順が読めなくても、払戻の判定は進める（着順は、後から取り直して埋める）
  if (r.cancelled) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO bb_race_results (race_key, status, order_json, payouts_json, scratched_json, fetched_at) VALUES (?, 'cancelled', '[]', '{}', ?, ?)`
    ).bind(raceKey, JSON.stringify(r.scratched), t).run();
    await settleEntries(env, raceKey, quota);
    return { status: 'cancelled' };
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO bb_race_results (race_key, status, order_json, payouts_json, scratched_json, fetched_at) VALUES (?, 'settled', ?, ?, ?, ?)`
  ).bind(raceKey, JSON.stringify(r.order), JSON.stringify(r.payouts), JSON.stringify(r.scratched), t).run();
  await settleEntries(env, raceKey, quota);
  return { status: 'settled', order: r.order.length, order_source: r.order_source };
}

// レースごとの「結果を更新」：そのレースの結果だけを、いま取りに行く（誰でも押せる。取得元への問い合わせは30秒に1回まで）
//   結果がまだない → 結果を確かめて、出ていれば保存・判定する。結果はあるが着順が空 → 着順だけ取り直す
async function apiRefreshRace(env, roomId, raceKey) {
  const room = await loadRoom(env, roomId);
  if (!room) return json({ error: 'not_found' }, 404);
  if (room.state !== 'open' && room.state !== 'finished') return json({ error: 'not_open' }, 409);
  const inRoom = await env.DB.prepare(
    `SELECT 1 AS x FROM bb_room_races WHERE room_id = ?1 AND race_key = ?2 UNION SELECT 1 FROM bb_entries WHERE room_id = ?1 AND race_key = ?2 LIMIT 1`
  ).bind(roomId, raceKey).first();
  if (!inRoom) return json({ error: 'not_found' }, 404);
  const has = await env.DB.prepare('SELECT status FROM bb_race_results WHERE race_key = ?').bind(raceKey).first();
  if (!has) {
    const r = await settleRace(env, raceKey, { entries: 6 });
    if (r.status !== 'pending') await finalizeRooms(env, 1);
    return json({ ok: true, status: r.status, reason: r.reason || null, race_status: r.race_status ?? null, order: r.order ?? null, order_source: r.order_source || null });
  }
  const o = await refreshOrder(env, raceKey);
  await settleEntries(env, raceKey, { entries: 6 });
  return json({ ok: true, status: o.status, reason: o.reason || null, order: o.order, order_source: o.order_source || null });
}

// 保存してある結果で、そのレースのまだ判定していない買い目を判定する
//   quota.entries … この実行で、あと何件の投稿を判定してよいか（使った分を減らす）
async function settleEntries(env, raceKey, quota) {
  if (quota.entries <= 0) return;
  const res = await env.DB.prepare('SELECT * FROM bb_race_results WHERE race_key = ?').bind(raceKey).first();
  if (!res) return;
  const entries = (await env.DB.prepare(`SELECT entry_id FROM bb_entries WHERE race_key = ? AND status = 'submitted' LIMIT ?`).bind(raceKey, quota.entries).all()).results;
  if (entries.length === 0) return;
  quota.entries -= entries.length;
  let payouts = JSON.parse(res.payouts_json || '{}');
  const scratched = new Set(JSON.parse(res.scratched_json || '[]'));
  const t = now();
  // 保存してある払戻に、これから判定する買い目の賭け式が入っていなければ、取り足す（結果を保存した後で、別の賭け式のバトルルームから投稿があった場合）
  if (res.status === 'settled') {
    const marks = entries.map(() => '?').join(',');
    const used = (await env.DB.prepare(`SELECT DISTINCT bet_type FROM bb_tickets WHERE entry_id IN (${marks})`).bind(...entries.map((e) => e.entry_id)).all()).results.map((x) => x.bet_type);
    const missing = used.filter((b) => BET_TYPES.includes(b) && !payouts[b]);
    if (missing.length) {
      const row = await env.DB.prepare('SELECT race_key, cup_code, day_num, race_num FROM bb_races WHERE race_key = ?').bind(raceKey).first();
      const more = row ? await fetchResult(env, row, missing) : { ok: false };
      if (!more.ok || more.cancelled) { quota.entries += entries.length; return; }       // 取れなければ、今回は判定しない（次の実行でやり直す）
      payouts = { ...payouts, ...more.payouts };
      await env.DB.prepare('UPDATE bb_race_results SET payouts_json = ? WHERE race_key = ?').bind(JSON.stringify(payouts), raceKey).run();
    }
  }
  for (const e of entries) {
    const tickets = (await env.DB.prepare('SELECT ticket_id, bet_type, combo, amount FROM bb_tickets WHERE entry_id = ?').bind(e.entry_id).all()).results;
    let refund = 0, payout = 0, hit = 0;
    const stmts = [];
    for (const tk of tickets) {
      let result = 'miss', pay = 0;
      const cars = tk.combo.split('-').map(Number);
      if (res.status === 'cancelled' || cars.some((n) => scratched.has(n))) { result = 'refund'; refund += tk.amount; }
      else {
        const unit = payouts[tk.bet_type] && payouts[tk.bet_type][tk.combo];
        if (unit > 0) { result = 'hit'; pay = Math.floor(tk.amount / 100) * unit; payout += pay; hit = 1; }
      }
      stmts.push(env.DB.prepare('UPDATE bb_tickets SET result = ?, payout = ? WHERE ticket_id = ?').bind(result, pay, tk.ticket_id));
    }
    stmts.push(env.DB.prepare(`UPDATE bb_entries SET status = 'settled', refund = ?, payout = ?, hit = ?, settled_at = ? WHERE entry_id = ? AND status = 'submitted'`)
      .bind(refund, payout, hit, t, e.entry_id));
    await env.DB.batch(stmts);
  }
}

// 参加者ごとの成績を集計する（途中経過と最終結果の両方で使う）
//   doneKeys     … 結果が保存されているレース（中止を含む）
//   cancelledKeys… そのうち中止のレース
//   final        … 最終結果のとき true（任意モードで、投票しなかったレース数ぶんを未投票として数える）
function tally(room, members, raceKeys, entryRows, doneKeys, cancelledKeys, final) {
  const rows = members.map((m) => {
    const mine = entryRows.filter((e) => e.user_id === m.user_id);
    let stake = 0, refund = 0, payout = 0, races = 0, hits = 0;
    for (const e of mine) {
      if (e.status === 'no_vote') { stake += e.stake; races += 1; continue; }     // 終了時に記録した未投票
      if (e.status !== 'settled') continue;
      stake += e.stake; refund += e.refund; payout += e.payout; races += 1; hits += e.hit ? 1 : 0;
    }
    if (room.mode === 'fixed') {
      // 結果が出た指定レースに投票していなければ、未投票（固定額を投資して払戻0）。中止のレースは数えない
      for (const k of raceKeys) {
        if (doneKeys.has(k) && !cancelledKeys.has(k) && !mine.some((e) => e.race_key === k)) { stake += room.stake; races += 1; }
      }
    } else if (final) {
      const missing = Math.max(0, room.race_count - mine.length);
      stake += missing * room.stake; races += missing;
    }
    const base = stake - refund;
    return { user_id: m.user_id, stake, refund, payout, races, hits, roi: base > 0 ? Math.round((payout / base) * 1000) / 10 : null };
  });
  // 順位：回収率の高い順。同じ回収率は同じ順位
  const sorted = rows.slice().sort((a, b) => (b.roi ?? -1) - (a.roi ?? -1));
  sorted.forEach((r, i) => { r.rank = i > 0 && (sorted[i - 1].roi ?? -1) === (r.roi ?? -1) ? sorted[i - 1].rank : i + 1; });
  return sorted;
}

// 終了の条件を満たした、成立中のバトルルームを終了させる（勝敗の確定）
async function finalizeRooms(env, limit) {
  const t = now();
  // 開催日の翌日6時（日本時間）を過ぎた開催日（各自が選ぶバトルルームの打ち切り用）
  const overDate = jstDate(t - 30 * 3600);
  const rooms = (await env.DB.prepare(
    `SELECT ro.* FROM bb_rooms ro
      WHERE ro.state = 'open' AND ro.hidden = 0
        AND NOT EXISTS (SELECT 1 FROM bb_entries e WHERE e.room_id = ro.room_id AND e.status = 'submitted')
        AND (
          (ro.mode = 'fixed'
            AND EXISTS (SELECT 1 FROM bb_room_races rr WHERE rr.room_id = ro.room_id)
            AND NOT EXISTS (SELECT 1 FROM bb_room_races rr LEFT JOIN bb_race_results x ON x.race_key = rr.race_key
                             WHERE rr.room_id = ro.room_id AND x.race_key IS NULL))
          OR
          (ro.mode = 'free' AND (
            ro.battle_date <= ?
            OR NOT EXISTS (SELECT 1 FROM bb_members m WHERE m.room_id = ro.room_id
                            AND (SELECT COUNT(*) FROM bb_entries e2 WHERE e2.room_id = ro.room_id AND e2.user_id = m.user_id) < ro.race_count)))
        )
      ORDER BY ro.established_at LIMIT ?`
  ).bind(overDate, limit || TICK_ROOMS).all()).results;
  for (const room of rooms) {
    const members = (await env.DB.prepare('SELECT user_id FROM bb_members WHERE room_id = ?').bind(room.room_id).all()).results;
    const entryRows = (await env.DB.prepare('SELECT * FROM bb_entries WHERE room_id = ?').bind(room.room_id).all()).results;
    const fixedKeys = (await env.DB.prepare('SELECT race_key FROM bb_room_races WHERE room_id = ? ORDER BY seq').bind(room.room_id).all()).results.map((r) => r.race_key);
    const keys = [...new Set([...fixedKeys, ...entryRows.map((e) => e.race_key)])];
    const doneKeys = new Set(), cancelledKeys = new Set();
    if (keys.length) {
      const marks = keys.map(() => '?').join(',');
      (await env.DB.prepare(`SELECT race_key, status FROM bb_race_results WHERE race_key IN (${marks})`).bind(...keys).all()).results
        .forEach((r) => { doneKeys.add(r.race_key); if (r.status === 'cancelled') cancelledKeys.add(r.race_key); });
    }

    const result = tally(room, members, fixedKeys, entryRows, doneKeys, cancelledKeys, true);
    const noWinner = result.every((r) => (r.roi ?? -1) === (result[0].roi ?? -1)) ? 1 : 0;
    const stmts = [];
    // 指定レースの未投票を、記録として残す
    if (room.mode === 'fixed') {
      for (const m of members) for (const k of fixedKeys) {
        if (!cancelledKeys.has(k) && !entryRows.some((e) => e.user_id === m.user_id && e.race_key === k)) {
          stmts.push(env.DB.prepare(
            `INSERT OR IGNORE INTO bb_entries (entry_id, room_id, user_id, race_key, status, stake, ticket_count, settled_at) VALUES (?,?,?,?,'no_vote',?,0,?)`
          ).bind(rid(16), room.room_id, m.user_id, k, room.stake, t));
        }
      }
    }
    for (const r of result) {
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO bb_room_results (room_id, user_id, rank, stake, refund, payout, roi) VALUES (?,?,?,?,?,?,?)')
        .bind(room.room_id, r.user_id, r.rank, r.stake, r.refund, r.payout, r.roi));
    }
    // 終了から12時間は、会員でない人にも公開する
    stmts.push(env.DB.prepare(`UPDATE bb_rooms SET state = 'finished', finished_at = ?, public_until = ?, no_winner = ? WHERE room_id = ? AND state = 'open'`)
      .bind(t, t + 12 * 3600, noWinner, room.room_id));
    await env.DB.batch(stmts);
  }
}

// 結果の確認を1回分進める：発走時刻を過ぎて、まだ結果を持っていないレースを確かめ、終了できるバトルルームを終了させる
//   force = true （定期実行）  ：上限いっぱいまで進める
//   force = false（閲覧時のついで）：1回につき、どれか1つだけ進める。
//     バトルルームの表示そのものが、データベースの問い合わせを20回ほど使う。無料プランの上限（1回の実行で50回）を
//     超えないように、ついで実行は「レース1つの結果を確かめる」か「バトルルーム1つを終了させる」のどちらか1つにとどめる
let lazyTurn = 0;
async function settleTick(env, force) {
  const t = now();
  if (!force) {
    const gap = env.LAZY_GAP !== undefined ? Number(env.LAZY_GAP) : LAZY_GAP;
    if (t - lastLazy < gap) return;
    lastLazy = t;
  }
  const quota = { entries: force ? TICK_ENTRIES : 2 };
  const due = (await env.DB.prepare(
    `SELECT DISTINCT k.race_key FROM (
        SELECT e.race_key FROM bb_entries e JOIN bb_rooms ro ON ro.room_id = e.room_id WHERE e.status = 'submitted' AND ro.hidden = 0
        UNION
        SELECT rr.race_key FROM bb_room_races rr JOIN bb_rooms ro ON ro.room_id = rr.room_id WHERE ro.state = 'open' AND ro.hidden = 0
      ) k
      JOIN bb_races r ON r.race_key = k.race_key
      LEFT JOIN bb_race_results x ON x.race_key = k.race_key
     WHERE x.race_key IS NULL AND (r.start_at IS NULL OR r.start_at <= ? OR r.cancel = 1)
     ORDER BY r.start_at LIMIT ?`
  ).bind(t, force ? TICK_RACES : 1).all()).results;
  if (!force) {
    // ついで実行：順番に、(1) レースの結果 → (2) 残っている判定 → (3) バトルルームの終了、のどれか1つ
    lazyTurn = (lazyTurn + 1) % 3;
    if (due.length && lazyTurn !== 2) { await settleRace(env, due[0].race_key, quota); return; }
    if (lazyTurn === 1 || !due.length) {
      const left = await env.DB.prepare(
        `SELECT e.race_key FROM bb_entries e JOIN bb_race_results x ON x.race_key = e.race_key JOIN bb_rooms ro ON ro.room_id = e.room_id
          WHERE e.status = 'submitted' AND ro.hidden = 0 LIMIT 1`
      ).first();
      if (left) { await settleEntries(env, left.race_key, quota); return; }
    }
    await finalizeRooms(env, 1);
    return;
  }
  for (const d of due) await settleRace(env, d.race_key, quota);
  // 結果は保存済みで、まだ判定していない投稿（前回の実行で残った分など）
  if (quota.entries > 0) {
    const left = (await env.DB.prepare(
      `SELECT DISTINCT e.race_key FROM bb_entries e JOIN bb_race_results x ON x.race_key = e.race_key JOIN bb_rooms ro ON ro.room_id = e.room_id
        WHERE e.status = 'submitted' AND ro.hidden = 0 LIMIT 3`
    ).all()).results;
    for (const d of left) await settleEntries(env, d.race_key, quota);
  }
  await finalizeRooms(env);
  // 着順が空のまま保存されたレース（この2日以内）を、1回につき1つ埋める
  const hole = await env.DB.prepare(`SELECT race_key FROM bb_race_results WHERE status = 'settled' AND order_json = '[]' AND fetched_at > ? LIMIT 1`).bind(t - 2 * 86400).first();
  if (hole) await refreshOrder(env, hole.race_key);
}

// ---------------------------------------------------------------------
// 取得元から取りに行くための小道具
// ---------------------------------------------------------------------
const srcWeb = (env) => env.SRC_WINTICKET || 'https://www.winticket.jp';
const srcApi = (env) => env.SRC_WINTICKET_API || 'https://api.winticket.jp';

async function fetchSource(url) {
  const out = { url, ok: false, status: 0, type: '', length: 0, text: '', error: null };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    out.status = res.status;
    out.ok = res.ok;
    out.type = res.headers.get('Content-Type') || '';
    out.text = await res.text();
    out.length = out.text.length;
  } catch (e) {
    out.error = String(e && e.message ? e.message : e).slice(0, 120);
  }
  return out;
}

// HTMLの中から、指定した id を持つ要素の範囲（開始タグから対応する終了タグまで）を切り出す
// 同じ種類のタグの入れ子を数えて、対応する終了タグを探す
function elementById(html, id) {
  const mark = `id="${id}"`;
  const at = html.indexOf(mark);
  if (at < 0) return null;
  const open = html.lastIndexOf('<', at);
  const tag = (html.slice(open + 1, open + 20).match(/^[a-zA-Z0-9]+/) || [])[0];
  if (!tag) return null;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = open;
  let depth = 0, m;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) { depth -= 1; if (depth === 0) return html.slice(open, m.index + m[0].length); }
    else if (!m[0].endsWith('/>')) depth += 1;
  }
  return html.slice(open);      // 終了タグが見つからないときは、末尾まで
}

// 開催一覧のページから、指定したパネル（today / tomorrow）の中の開催を取り出す
//   1つの開催は、クラス名に「RecentRaceListItem___Wrapper」を含む箱。その中に、レースへのリンクと、時間帯の印がある。
//   時間帯の印は、アイコンの title に「モーニング」「ナイター」「ミッドナイト」と書かれている。どれもなければデイ（Brain本体と同じ読み方）
//   リンクが結果のページ（raceresult）になっている開催は、その日のレースが終わっている
const SLOT_OF = { 'モーニング': 'morning', 'ナイター': 'nighter', 'ミッドナイト': 'midnight' };
function panelLinks(html, which) {
  const seg = elementById(html, `panel-keirin-race-${which}`);
  if (seg === null) return null;
  const links = [];
  const seen = new Set();
  const re = /href="(\/keirin\/([^\/?"]+)\/(racecard|raceresult)\/(\d+)(?:\/(\d+)(?:\/(\d+))?|\/races(?:\?[^"]*?index=(\d+))?)?[^"]*)"/g;
  // 開催ごとの箱に区切る。区切りが見つからないときは、パネル全体を1つとして扱う（時間帯はデイになる）
  const chunks = seg.split('RecentRaceListItem___Wrapper');
  for (const chunk of chunks.length > 1 ? chunks.slice(1) : chunks) {
    re.lastIndex = 0;
    const tm = chunk.match(/<title>(モーニング|ナイター|ミッドナイト)<\/title>/);
    const slot = tm ? SLOT_OF[tm[1]] : 'day';
    let m;
    while ((m = re.exec(chunk)) !== null) {
      const item = { venue: m[2], type: m[3], cup: m[4], day: m[5] || m[7] || '1', race: m[6] || null, list: m[1].includes('/races'), slot };
      const key = item.venue + '|' + item.cup + '|' + item.day;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push(item);
    }
  }
  return links;
}

// ---------------------------------------------------------------------
// 自分の情報
// ---------------------------------------------------------------------
async function apiMe(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ logged_in: false });

  // 届いている招待（未応答）と、参加中の部屋
  const invites = await env.DB.prepare(
    `SELECT r.room_id, r.state, r.battle_date, r.join_deadline, r.race_count, r.stake, r.mode, r.bet_types
       FROM bb_invites i JOIN bb_rooms r ON r.room_id = i.room_id
      WHERE i.handle = ? AND i.status = 'pending' AND r.state IN ('recruiting','open')
        AND r.join_deadline > ? AND r.hidden = 0
      ORDER BY r.join_deadline`
  ).bind((user.handle || '').toLowerCase(), now()).all();
  const rooms = await env.DB.prepare(
    `SELECT r.room_id, r.state, r.battle_date, r.join_deadline, r.race_count, r.stake, r.mode, r.bet_types, m.is_creator
       FROM bb_members m JOIN bb_rooms r ON r.room_id = m.room_id
      WHERE m.user_id = ? AND r.state IN ('recruiting','open') AND r.hidden = 0
      ORDER BY r.created_at DESC LIMIT 50`
  ).bind(user.user_id).all();

  // 今月（日本時間）の集客pt：自分のリンクから来場した人数
  const pt = await env.DB.prepare('SELECT COUNT(*) AS n FROM bb_visits WHERE sharer_id = ? AND day >= ?')
    .bind(user.user_id, jstDate(now()).slice(0, 8) + '01').first();

  const ptAll = await env.DB.prepare('SELECT COUNT(*) AS n FROM bb_visits WHERE sharer_id = ?').bind(user.user_id).first();
  const pmUntil = await premiumUntil(request, env, user);

  return json({
    logged_in: true,
    user: { ...publicUser(user), x_name: user.x_name, status: user.status },
    visit_pt_month: pt.n,
    visit_pt_total: ptAll.n,
    premium: pmUntil > now(),
    is_admin: isAdmin(env, user),
    invites: await attachMembers(env, await attachRaces(env, invites.results.map(splitBets))),
    rooms: await attachMembers(env, await attachRaces(env, rooms.results.map(splitBets))),
  });
}

// 賭け式を「カンマ区切りの文字」から一覧に直す
function splitBets(row) {
  return { ...row, bet_types: String(row.bet_types || '').split(',').filter(Boolean) };
}

// バトルルームの一覧の各行に、参加者（参加を承諾した人だけ。参加した順）を付ける
async function attachMembers(env, rows) {
  if (rows.length === 0) return rows;
  const marks = rows.map(() => '?').join(',');
  const members = (await env.DB.prepare(
    `SELECT m.room_id, m.is_creator, u.user_id, u.handle, u.display_name, u.icon_url
       FROM bb_members m JOIN bb_users u ON u.user_id = m.user_id
      WHERE m.room_id IN (${marks}) ORDER BY m.joined_at, m.rowid`   // 同じ秒に参加した人どうしは、参加した順
  ).bind(...rows.map((r) => r.room_id)).all()).results;
  return rows.map((r) => ({
    ...r,
    members: members.filter((m) => m.room_id === r.room_id).map((m) => ({ ...publicUser(m), is_creator: !!m.is_creator })),
  }));
}

// バトルルームの一覧の各行に、指定レース（順番どおり）を付ける。任意モードは空の一覧
async function attachRaces(env, rows) {
  if (rows.length === 0) return rows;
  const marks = rows.map(() => '?').join(',');
  const races = (await env.DB.prepare(
    `SELECT room_id, race_key FROM bb_room_races WHERE room_id IN (${marks}) ORDER BY room_id, seq`
  ).bind(...rows.map((r) => r.room_id)).all()).results;
  return rows.map((r) => ({ ...r, races: races.filter((x) => x.room_id === r.room_id).map((x) => x.race_key) }));
}

async function apiSetName(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'login_required' }, 401);
  const body = await readBody(request);
  const name = cleanName(body && body.display_name);
  if (!name) return json({ error: 'invalid_name' }, 400);
  await env.DB.prepare('UPDATE bb_users SET display_name = ? WHERE user_id = ?').bind(name, user.user_id).run();
  return json({ ok: true, display_name: name });
}

// ---------------------------------------------------------------------
// 部屋の作成
// ---------------------------------------------------------------------
async function apiCreateRoom(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'login_required' }, 401);
  if (user.status !== 'active') return json({ error: 'suspended' }, 403);
  const b = await readBody(request);
  if (!b) return json({ error: 'invalid_body' }, 400);
  const t = now();
  const bad = (field) => json({ error: 'invalid', field }, 400);

  // レース数（上限12は仮の値）
  const raceCount = Number(b.race_count);
  if (!Number.isInteger(raceCount) || raceCount < 1 || raceCount > 12) return bad('race_count');

  const mode = b.mode;
  if (mode !== 'fixed' && mode !== 'free') return bad('mode');

  const stake = Number(b.stake);
  if (!STAKES.includes(stake)) return bad('stake');

  // 賭け式：3種類から1つだけ。「指定なし」も複数も不可
  const betTypes = Array.isArray(b.bet_types) ? b.bet_types : [];
  if (betTypes.length !== 1 || !BET_TYPES.includes(betTypes[0])) return bad('bet_types');
  const betTypesStr = betTypes[0];

  // 買い目の公開タイミング（分数の範囲 1〜60 は仮の値）
  const revealMode = b.reveal_mode;
  let revealMinutes = null;
  if (revealMode === 'before_start') {
    revealMinutes = Number(b.reveal_minutes);
    if (!Number.isInteger(revealMinutes) || revealMinutes < 1 || revealMinutes > 60) return bad('reveal_minutes');
  } else if (revealMode !== 'instant') return bad('reveal_mode');

  const quorum = b.quorum;
  if (quorum !== 'all' && quorum !== 'two_plus') return bad('quorum');

  // 開催日：当日または翌日（日本時間）。事前に開設できる日数は未決のため仮の範囲
  const battleDate = String(b.battle_date || '');
  if (battleDate !== jstDate(t) && battleDate !== jstDate(t + 86400)) return bad('battle_date');

  // 参加締切：未来で、開催日の終わりまで
  const joinDeadline = Number(b.join_deadline);
  if (!Number.isInteger(joinDeadline) || joinDeadline <= t || jstDate(joinDeadline) > battleDate) {
    return bad('join_deadline');
  }

  // 指定モードはレース数ぶんのレースが必要。任意モードは指定しない
  let races = [];
  if (mode === 'fixed') {
    races = Array.isArray(b.races) ? b.races.map(String) : [];
    if (races.length !== raceCount || new Set(races).size !== races.length) return bad('races');
    const ymd = battleDate.replace(/-/g, '');
    if (races.some((k) => !validRaceKey(k, ymd))) return bad('races');

    // サーバーが持っているレース情報で確かめる：実在するか、中止でないか、締切前か
    const reason = (field, why) => json({ error: 'invalid', field, reason: why }, 400);
    let firstDeadline = Infinity;
    const venues = [...new Set(races.map((k) => k.split('-')[1]))];
    for (const venue of venues) {
      const info = await loadRaces(env, battleDate, venue);
      for (const k of races.filter((x) => x.split('-')[1] === venue)) {
        const row = info.races.find((x) => x.race_key === k);
        if (!row) return reason('races', 'not_found');
        if (row.cancel) return reason('races', 'cancelled');
        if (!row.deadline_at || row.deadline_at <= t) return reason('races', 'closed');
        firstDeadline = Math.min(firstDeadline, row.deadline_at);
      }
    }
    // 参加の締切は、最初に締め切られる対象レースの締切まで
    if (joinDeadline > firstDeadline) return reason('join_deadline', 'after_first_race');
  } else if (Array.isArray(b.races) && b.races.length > 0) return bad('races');

  // 相手の決め方
  //   invite：XのIDで相手を指定して招待する（これまでの形）
  //   open  ：相手をランダムに募集する。招待のポストを見た人が、先着順で参加できる。募集する人数（slots）を決める
  const recruit = b.recruit === 'open' ? 'open' : 'invite';
  let capacity = null;
  if (recruit === 'open') {
    const slots = Number(b.slots);
    if (!Number.isInteger(slots) || slots < 1 || slots > MAX_MEMBERS - 1) return bad('slots');
    if (Array.isArray(b.invites) && b.invites.length > 0) return bad('invites');      // 募集のときは、相手を指定しない
    capacity = slots + 1;
  }

  // 招待：1人以上、作成者を含めて上限以内。自分自身と重複は不可
  const invites = recruit === 'invite' && Array.isArray(b.invites)
    ? [...new Set(b.invites.map((h) => String(h).replace(/^@/, '').trim()))]
    : [];
  if (recruit === 'invite' && (invites.length < 1 || invites.length > MAX_MEMBERS - 1)) return bad('invites');
  if (invites.some((h) => !HANDLE_RE.test(h))) return bad('invites');
  const lowered = [...new Set(invites.map((h) => h.toLowerCase()))];
  if (lowered.length !== invites.length) return bad('invites');
  if (lowered.includes((user.handle || '').toLowerCase())) return bad('invites');

  const roomId = rid(10);
  const stmts = [
    env.DB.prepare(
      `INSERT INTO bb_rooms (room_id, creator_id, state, battle_date, race_count, mode, stake, bet_types,
                             reveal_mode, reveal_minutes, quorum, join_deadline, created_at, recruit, capacity)
       VALUES (?,?,'recruiting',?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(roomId, user.user_id, battleDate, raceCount, mode, stake, betTypesStr,
           revealMode, revealMinutes, quorum, joinDeadline, t, recruit, capacity),
    env.DB.prepare('INSERT INTO bb_members (room_id, user_id, is_creator, joined_at) VALUES (?,?,1,?)')
      .bind(roomId, user.user_id, t),
  ];
  races.forEach((k, i) => {
    stmts.push(env.DB.prepare('INSERT INTO bb_room_races (room_id, seq, race_key) VALUES (?,?,?)').bind(roomId, i + 1, k));
  });
  for (const h of lowered) {
    // すでに登録済みの予想屋なら、その場で結びつける
    stmts.push(
      env.DB.prepare(
        `INSERT INTO bb_invites (room_id, handle, status, user_id)
         VALUES (?, ?, 'pending', (SELECT user_id FROM bb_users WHERE lower(handle) = ? AND status != 'deleted'))`
      ).bind(roomId, h, h)
    );
  }
  await env.DB.batch(stmts);
  return json({ ok: true, room_id: roomId, invites: lowered, recruit, capacity }, 201);
}

// ---------------------------------------------------------------------
// 成立済みの部屋の一覧（トップ画面用。当日分と翌日分）
// ---------------------------------------------------------------------
// 終了したバトルルームを、結果（順位と回収率）つきで取り出す。where は追加の条件（SQL）
async function finishedRooms(env, where, binds, limit) {
  const done = (await env.DB.prepare(
    `SELECT room_id, battle_date, race_count, mode, stake, bet_types, established_at, finished_at, no_winner
       FROM bb_rooms
      WHERE state = 'finished' AND hidden = 0 AND ${where}
      ORDER BY finished_at DESC LIMIT ?`
  ).bind(...binds, limit).all()).results;
  if (!done.length) return [];
  const full = await attachMembers(env, await attachRaces(env, done));
  const marks = done.map(() => '?').join(',');
  const res = (await env.DB.prepare(
    `SELECT room_id, user_id, rank, payout, roi FROM bb_room_results WHERE room_id IN (${marks}) ORDER BY rank`
  ).bind(...done.map((r) => r.room_id)).all()).results;
  return full.map((r) => ({
    room_id: r.room_id, battle_date: r.battle_date, race_count: r.race_count, mode: r.mode, stake: r.stake,
    bet_types: r.bet_types.split(','), races: r.races, established_at: r.established_at, members: r.members,
    finished_at: r.finished_at, no_winner: !!r.no_winner,
    results: res.filter((x) => x.room_id === r.room_id).map((x) => ({ user_id: x.user_id, rank: x.rank, payout: x.payout, roi: x.roi })),
  }));
}

async function apiListRooms(env) {
  const t = now();
  const shape = (r) => ({
    room_id: r.room_id,
    battle_date: r.battle_date,
    race_count: r.race_count,
    mode: r.mode,
    stake: r.stake,
    bet_types: r.bet_types.split(','),
    races: r.races,
    established_at: r.established_at,
    members: r.members,
  });
  const rooms = (await env.DB.prepare(
    `SELECT room_id, battle_date, race_count, mode, stake, bet_types, established_at
       FROM bb_rooms
      WHERE state = 'open' AND hidden = 0 AND battle_date IN (?, ?)
      ORDER BY established_at DESC LIMIT 50`
  ).bind(jstDate(t), jstDate(t + 86400)).all()).results;
  const open = rooms.length ? (await attachMembers(env, await attachRaces(env, rooms))).map(shape) : [];

  // 終了したバトルルーム：終了から12時間（公開の期限まで）のもの。新しい順。結果（順位と回収率）を付ける
  const finished = await finishedRooms(env, 'public_until > ?', [t], 20);
  // 対戦相手を募集中（ランダムに募集）で、まだ空きがあり、参加の締切前のもの。新しい順
  const rec = (await env.DB.prepare(
    `SELECT ro.room_id, ro.battle_date, ro.race_count, ro.mode, ro.stake, ro.bet_types, ro.established_at, ro.capacity, ro.join_deadline, ro.quorum, ro.state
       FROM bb_rooms ro
      WHERE ro.recruit = 'open' AND ro.hidden = 0 AND ro.join_deadline > ?
        AND (ro.state = 'recruiting' OR (ro.state = 'open' AND ro.quorum = 'two_plus'))
        AND (SELECT COUNT(*) FROM bb_members m WHERE m.room_id = ro.room_id) < ro.capacity
      ORDER BY ro.created_at DESC LIMIT 20`
  ).bind(t).all()).results;
  const recruiting = rec.length
    ? (await attachMembers(env, await attachRaces(env, rec))).map((r) => ({ ...shape(r), state: r.state, capacity: r.capacity, slots_left: Math.max(0, r.capacity - r.members.length), join_deadline: r.join_deadline }))
    : [];
  return json({ rooms: open, finished, recruiting });
}

// ---------------------------------------------------------------------
// 部屋の状態を最新にする（参加締切を過ぎたときの処理）
// ---------------------------------------------------------------------
async function refreshRoom(env, room) {
  const t = now();
  if (t < room.join_deadline) return room;
  if (room.state === 'recruiting') {
    // 締切までに成立しなかった部屋は不成立。未応答の招待は期限切れ
    await env.DB.batch([
      env.DB.prepare(`UPDATE bb_rooms SET state = 'void' WHERE room_id = ? AND state = 'recruiting'`).bind(room.room_id),
      env.DB.prepare(`UPDATE bb_invites SET status = 'expired' WHERE room_id = ? AND status = 'pending'`).bind(room.room_id),
    ]);
    return { ...room, state: 'void' };
  }
  if (room.state === 'open') {
    await env.DB.prepare(`UPDATE bb_invites SET status = 'expired' WHERE room_id = ? AND status = 'pending'`)
      .bind(room.room_id).run();
  }
  return room;
}

async function loadRoom(env, roomId) {
  const room = await env.DB.prepare('SELECT * FROM bb_rooms WHERE room_id = ?').bind(roomId).first();
  if (!room || room.hidden) return null;
  return refreshRoom(env, room);
}

// ---------------------------------------------------------------------
// 部屋の取得
// ---------------------------------------------------------------------
async function apiGetRoom(request, env, roomId) {
  const room = await loadRoom(env, roomId);
  if (!room) return json({ error: 'not_found' }, 404);
  const user = await currentUser(request, env);

  const members = (await env.DB.prepare(
    `SELECT u.user_id, u.handle, u.display_name, u.icon_url, m.is_creator
       FROM bb_members m JOIN bb_users u ON u.user_id = m.user_id
      WHERE m.room_id = ? ORDER BY m.joined_at, m.rowid`
  ).bind(roomId).all()).results;

  const isMember = !!user && members.some((m) => m.user_id === user.user_id);
  let myInvite = null;
  if (user && !isMember && user.handle) {
    myInvite = await env.DB.prepare('SELECT status FROM bb_invites WHERE room_id = ? AND handle = ?')
      .bind(roomId, user.handle.toLowerCase()).first();
  }
  const viewer = isMember ? 'member' : myInvite ? 'invited' : 'guest';

  // 募集中・不成立の部屋は、作成者・参加者・招待された本人にだけ中身を見せる
  //   ただし、相手をランダムに募集しているバトルルームは、募集中の間、誰にでも中身を見せる（見た人が参加を決められるように）
  const openCall = room.recruit === 'open';
  if ((room.state === 'recruiting' || room.state === 'void') && viewer === 'guest' && !(openCall && room.state === 'recruiting')) {
    return json({ room_id: roomId, state: room.state, viewer, can_delete: isAdmin(env, user) });
  }

  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM bb_invites WHERE room_id = ? AND status = 'pending'`
  ).bind(roomId).first();
  const races = (await env.DB.prepare('SELECT seq, race_key FROM bb_room_races WHERE room_id = ? ORDER BY seq')
    .bind(roomId).all()).results;

  // 参加者の投稿。成立したバトルルームでは、誰でも見られる（中身は公開のタイミングに従う）
  const t = now();
  const entryRows = (room.state === 'open' || room.state === 'finished')
    ? (await env.DB.prepare('SELECT entry_id, user_id, race_key, status, stake, refund, payout, hit, ticket_count, submitted_at, formations FROM bb_entries WHERE room_id = ? ORDER BY submitted_at, rowid').bind(roomId).all()).results
    : [];
  const votes = entryRows.filter((e) => e.status !== 'no_vote');        // 実際に投稿されたもの（未投票の記録を除く）

  // レースの発走・締切（サーバーが持っている値）。指定レースと、投稿のあったレース
  const keys = [...new Set([...races.map((r) => r.race_key), ...votes.map((e) => e.race_key)])];
  const raceRows = new Map();
  if (keys.length) {
    const marks = keys.map(() => '?').join(',');
    (await env.DB.prepare(`SELECT race_key, race_num, start_at, deadline_at, cancel FROM bb_races WHERE race_key IN (${marks})`).bind(...keys).all())
      .results.forEach((x) => raceRows.set(x.race_key, x));
  }
  // 結果（保存してあるもの）。払戻は、このバトルルームの賭け式の分だけ返す
  const bet0 = room.bet_types.split(',')[0];
  const resultOf = new Map();
  const doneKeys = new Set(), cancelledKeys = new Set();
  if (keys.length) {
    const marks = keys.map(() => '?').join(',');
    (await env.DB.prepare(`SELECT race_key, status, order_json, payouts_json, scratched_json FROM bb_race_results WHERE race_key IN (${marks})`).bind(...keys).all())
      .results.forEach((x) => {
        doneKeys.add(x.race_key);
        if (x.status === 'cancelled') cancelledKeys.add(x.race_key);
        let order = [], pay = {}, scratched = [];
        try { order = JSON.parse(x.order_json || '[]'); pay = (JSON.parse(x.payouts_json || '{}'))[bet0] || {}; scratched = JSON.parse(x.scratched_json || '[]'); } catch (err) { /* 壊れた記録は空として扱う */ }
        resultOf.set(x.race_key, { status: x.status, order, payouts: pay, scratched });
      });
  }
  const infoOf = (key) => {
    const x = raceRows.get(key);
    const base = x ? publicRace(x, t) : { race_key: key, race_num: Number(key.split('-')[2]), start_at: null, deadline_at: null, cancel: false, closed: false };
    return { ...base, result: resultOf.get(key) || null };
  };
  // 指定モードは指定した順。任意モードは、投稿のあったレースを発走の早い順
  const raceInfo = races.length
    ? races.map((r) => infoOf(r.race_key))
    : keys.map(infoOf).sort((a, b) => (a.start_at || 0) - (b.start_at || 0) || (a.race_key < b.race_key ? -1 : 1));

  // 買い目の公開
  //   すぐ公開      ：投稿した時点で公開
  //   発走の○分前  ：そのレースの発走時刻の○分前になったら公開（発走時刻が分からないときは、締切時刻で公開）
  //   公開前は「投稿済みであること」だけを返し、点数・買い目・金額は返さない
  const entries = [];
  const shown = [];
  for (const e of votes) {
    const info = raceRows.get(e.race_key);
    let revealAt = 0;
    if (room.reveal_mode !== 'instant') {
      revealAt = info && info.start_at ? info.start_at - (room.reveal_minutes || 0) * 60 : (info && info.deadline_at) || null;
    }
    const revealed = revealAt !== null && t >= revealAt;
    const item = { race_key: e.race_key, user_id: e.user_id, submitted_at: e.submitted_at, revealed, reveal_at: revealed ? null : revealAt };
    if (revealed) {
      let fm = [];
      try { fm = e.formations ? JSON.parse(e.formations) : []; } catch (err) { fm = []; }
      item.ticket_count = e.ticket_count;
      item.formations = fm;
      item.tickets = [];
      if (e.status === 'settled') { item.settled = true; item.payout = e.payout; item.refund = e.refund; item.hit = !!e.hit; }
      shown.push([e.entry_id, item]);
    }
    entries.push(item);
  }
  if (shown.length) {
    const marks = shown.map(() => '?').join(',');
    const tk = (await env.DB.prepare(`SELECT entry_id, combo, amount, odds_at_submit, result, payout FROM bb_tickets WHERE entry_id IN (${marks}) ORDER BY ticket_id`)
      .bind(...shown.map((x) => x[0])).all()).results;
    const byId = new Map(shown);
    tk.forEach((x) => byId.get(x.entry_id).tickets.push({ combo: x.combo, amount: x.amount, odds: x.odds_at_submit, result: x.result, payout: x.payout }));
  }

  // 順位（結果が出たレースまでの成績）。終了したバトルルームでは、未投票ぶんも数えた最終結果
  const standings = (room.state === 'open' || room.state === 'finished')
    ? tally(room, members, races.map((r) => r.race_key), entryRows, doneKeys, cancelledKeys, room.state === 'finished')
    : [];

  // 自分の投稿（自分の買い目は、公開のタイミングに関係なく本人に見せる）
  let myEntries;
  if (isMember) {
    const ent = (await env.DB.prepare(`SELECT entry_id, race_key, status, refund, payout, hit, ticket_count, submitted_at, formations FROM bb_entries WHERE room_id = ? AND user_id = ? AND status != 'no_vote' ORDER BY submitted_at`)
      .bind(roomId, user.user_id).all()).results;
    myEntries = [];
    // 買い目は、1回の問い合わせでまとめて読む（投稿の数だけ問い合わせると、無料プランの上限に近づくため）
    let allTk = [];
    if (ent.length) {
      const marks = ent.map(() => '?').join(',');
      allTk = (await env.DB.prepare(`SELECT entry_id, combo, amount, odds_at_submit, result, payout FROM bb_tickets WHERE entry_id IN (${marks}) ORDER BY ticket_id`)
        .bind(...ent.map((e) => e.entry_id)).all()).results;
    }
    for (const e of ent) {
      const tk = allTk.filter((x) => x.entry_id === e.entry_id);
      let fm = [];
      try { fm = e.formations ? JSON.parse(e.formations) : []; } catch (err) { fm = []; }
      const mine = { race_key: e.race_key, ticket_count: e.ticket_count, submitted_at: e.submitted_at, formations: fm, tickets: tk.map((x) => ({ combo: x.combo, amount: x.amount, odds: x.odds_at_submit, result: x.result, payout: x.payout })) };
      if (e.status === 'settled') { mine.settled = true; mine.payout = e.payout; mine.refund = e.refund; mine.hit = !!e.hit; }
      myEntries.push(mine);
    }
  }

  // 招待した相手の@IDと応答の状況は、作成者本人にだけ返す
  const isCreator = !!user && members.some((m) => m.is_creator && m.user_id === user.user_id);
  let invites;
  if (isCreator) {
    invites = (await env.DB.prepare('SELECT handle, status FROM bb_invites WHERE room_id = ? ORDER BY handle')
      .bind(roomId).all()).results;
  }

  // 応答待ちの招待相手の@ID。このバトルルームの中身を見られる人には、全員に返す（2026-10-05 方針変更。以前は作成者だけ）
  const waiting = (await env.DB.prepare(`SELECT handle FROM bb_invites WHERE room_id = ? AND status = 'pending' ORDER BY rowid`).bind(roomId).all()).results.map((x) => x.handle);

  return json({
    room_id: roomId,
    state: room.state,
    viewer,
    my_invite: myInvite ? myInvite.status : null,
    rules: {
      battle_date: room.battle_date,
      race_count: room.race_count,
      mode: room.mode,
      stake: room.stake,
      bet_types: room.bet_types.split(','),
      reveal_mode: room.reveal_mode,
      reveal_minutes: room.reveal_minutes,
      quorum: room.quorum,
      join_deadline: room.join_deadline,
    },
    races,
    race_info: raceInfo,
    entries,                        // 参加者全員の投稿（公開前は、投稿済みであることだけ）
    standings,                      // 順位（回収率の高い順）
    comments: (room.state === 'open' || room.state === 'finished') ? await loadComments(env, room, members, user) : [],
    can_comment: !!user && user.status === 'active' && (room.state === 'open' || room.state === 'finished'),
    can_delete: !!user && (isAdmin(env, user) || (room.creator_id === user.user_id && user.status === 'active' && votes.length === 0)),
    my_entries: myEntries,          // 参加者本人にだけ含める（公開前でも、自分の買い目は見える）
    // 表示するのは参加を承諾した人だけ。招待中は人数のみ
    members: members.map((m) => ({ ...publicUser(m), is_creator: !!m.is_creator })),
    pending_invites: pending.n,
    invites,                       // 招待の応答の状況（辞退・期限切れを含む）。作成者以外には含めない
    waiting,                       // 応答待ちの招待相手の@ID
    recruit: room.recruit || 'invite',                                   // 相手の決め方
    capacity: room.capacity || null,                                     // 定員（ランダムに募集するとき）
    slots_left: openCall ? Math.max(0, (room.capacity || 0) - members.length) : null,
    // ランダムに募集しているバトルルームに、いま参加できるか（空きがあり、参加の締切前で、まだ参加していない）
    joinable: openCall && (room.state === 'recruiting' || (room.state === 'open' && room.quorum === 'two_plus'))
      && now() < room.join_deadline && members.length < (room.capacity || 0) && !isMember,
    established_at: room.established_at,
    finished_at: room.finished_at,
    public_until: room.public_until,
    no_winner: !!room.no_winner,
  });
}

// ---------------------------------------------------------------------
// プレミアム（4桁の入場コード）
//   コードは2種類。どちらも管理画面で登録する。
//     bb    … BattleBank専用。noteで販売する。10日ごとに切り替える
//     brain … Brainの入場コード。毎月切り替わる。Brainの会員は、このコードでそのままプレミアムになる
//   有効期間の中にあるコードを入力できた人を、そのコードの期限までプレミアムユーザーとして扱う。
//   プレミアムの印は、端末（署名つきのクッキー）と、ログイン中ならアカウントの両方に付ける。
//   4桁は総当たりされやすいので、入力は回数制限（RL_CODE）に加えて、失敗の回数でも止める。
// ---------------------------------------------------------------------
const PM_COOKIE = 'bb_pm';
const CODE_FAIL_MAX = 10;        // 同じ接続元が、1時間に失敗できる回数

async function getSetting(env, name) {
  const r = await env.DB.prepare('SELECT value FROM bb_settings WHERE name = ?').bind(name).first();
  return r ? r.value : null;
}
async function setSetting(env, name, value) {
  await env.DB.prepare('INSERT OR REPLACE INTO bb_settings (name, value) VALUES (?, ?)').bind(name, value).run();
}
// プレミアムの印に署名するための鍵。最初に使うときに作って、データベースに持つ
async function pmSecret(env) {
  let s = await getSetting(env, 'pm_secret');
  if (!s) {
    s = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare('INSERT OR IGNORE INTO bb_settings (name, value) VALUES (?, ?)').bind('pm_secret', s).run();
    s = await getSetting(env, 'pm_secret');
  }
  return s;
}
async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// プレミアムの期限（unix秒）。プレミアムでなければ 0。管理者は常にプレミアム
async function premiumUntil(request, env, user) {
  const t = now();
  if (isAdmin(env, user)) return t + 365 * 86400;
  let until = user && user.premium_until > t ? user.premium_until : 0;
  const c = readCookie(request, PM_COOKIE);
  const m = c && c.match(/^(\d{9,11})\.([0-9a-f]{64})$/);
  if (m && Number(m[1]) > t && (await hmacHex(await pmSecret(env), 'pm:' + m[1])) === m[2]) until = Math.max(until, Number(m[1]));
  return until;
}

// 「10日間有効なコードを入手する」の行き先。
//   いま有効なBattleBank専用のコードに登録されている、noteの記事のアドレス（複数あるときは、期限がいちばん先のもの）。
//   どのコードにもアドレスがなければ、以前の設定（管理画面で単独に保存していたアドレス）を使う。
async function currentNoteUrl(env) {
  const t = now();
  const r = await env.DB.prepare(
    `SELECT note_url FROM bb_codes WHERE kind = 'bb' AND valid_from <= ? AND valid_until > ? AND note_url IS NOT NULL AND note_url != ''
      ORDER BY valid_until DESC, code_id DESC LIMIT 1`
  ).bind(t, t).first();
  return r ? r.note_url : await getSetting(env, 'note_url');
}
const NOTE_URL_RE = /^https:\/\/[^\s"'<>]+$/;

async function apiPremiumStatus(request, env) {
  const user = await currentUser(request, env);
  const until = await premiumUntil(request, env, user);
  return json({ premium: until > now(), until: until || null, note_url: await currentNoteUrl(env) });
}

async function apiPremiumEnter(request, env) {
  const b = await readBody(request);
  const code = String((b && b.code) || '');
  if (!/^\d{4}$/.test(code)) return json({ error: 'invalid', field: 'code' }, 400);
  const t = now();
  // 失敗の回数（接続元ごと・1時間ごと）
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipKey = (await hmacHex(await pmSecret(env), 'ip:' + ip)).slice(0, 24);
  const slot = Math.floor(t / 3600);
  const fails = await env.DB.prepare('SELECT n FROM bb_code_fails WHERE ip_key = ? AND slot = ?').bind(ipKey, slot).first();
  if (fails && fails.n >= CODE_FAIL_MAX) return json({ error: 'too_many_attempts' }, 429);

  const hit = await env.DB.prepare(
    'SELECT kind, MAX(valid_until) AS until FROM bb_codes WHERE code = ? AND valid_from <= ? AND valid_until > ? GROUP BY kind ORDER BY until DESC LIMIT 1'
  ).bind(code, t, t).first();
  if (!hit) {
    await env.DB.prepare('INSERT INTO bb_code_fails (ip_key, slot, n) VALUES (?, ?, 1) ON CONFLICT(ip_key, slot) DO UPDATE SET n = n + 1').bind(ipKey, slot).run();
    return json({ error: 'wrong_code', left: Math.max(0, CODE_FAIL_MAX - ((fails ? fails.n : 0) + 1)) }, 400);
  }
  const until = hit.until;
  const user = await currentUser(request, env);
  if (user) await env.DB.prepare('UPDATE bb_users SET premium_until = MAX(COALESCE(premium_until, 0), ?) WHERE user_id = ?').bind(until, user.user_id).run();
  const sig = await hmacHex(await pmSecret(env), 'pm:' + until);
  return json({ ok: true, until, kind: hit.kind }, 200, {
    'Set-Cookie': `${PM_COOKIE}=${until}.${sig}; Path=/; Max-Age=${Math.max(60, until - t)}; HttpOnly; Secure; SameSite=Lax`,
  });
}

// ---------------------------------------------------------------------
// 成績・対戦データ
//   期間は「今月分」（日本時間の月初から）か「累計」。終了したバトルルーム（削除したものを除く）を集計する。
//     回収率 … 払戻 ÷（投資 − 返還）× 100
//     払戻額 … 払戻の合計
//     的中率 … 的中したレース ÷ 判定したレース（未投票を含む。全額返還のレースは数えない）
//     集客pt … 自分のリンクから来場した人数
//   プレミアムでない人には、回収率の上位3人の「数字だけ」を返す（名前やIDは返さない。画面で隠すのではなく、送らない）。
// ---------------------------------------------------------------------
async function buildStats(env, period) {
  const t = now();
  const monthStart = Math.floor(Date.parse(jstDate(t).slice(0, 8) + '01T00:00:00+09:00') / 1000);
  const since = period === 'all' ? 0 : monthStart;
  const sinceDay = period === 'all' ? '0000-00-00' : jstDate(t).slice(0, 8) + '01';
  const res = (await env.DB.prepare(
    `SELECT rr.user_id, COUNT(*) AS battles, SUM(rr.stake) AS stake, SUM(rr.refund) AS refund, SUM(rr.payout) AS payout,
            SUM(CASE WHEN rr.rank = 1 AND ro.no_winner = 0 THEN 1 ELSE 0 END) AS wins
       FROM bb_room_results rr JOIN bb_rooms ro ON ro.room_id = rr.room_id
      WHERE ro.state = 'finished' AND ro.hidden = 0 AND ro.finished_at >= ?
      GROUP BY rr.user_id`
  ).bind(since).all()).results;
  const hits = (await env.DB.prepare(
    `SELECT e.user_id, COUNT(*) AS races, SUM(e.hit) AS hits
       FROM bb_entries e JOIN bb_rooms ro ON ro.room_id = e.room_id
      WHERE ro.state = 'finished' AND ro.hidden = 0 AND ro.finished_at >= ?
        AND (e.status = 'no_vote' OR (e.status = 'settled' AND e.refund < e.stake))
      GROUP BY e.user_id`
  ).bind(since).all()).results;
  const pts = (await env.DB.prepare('SELECT sharer_id AS user_id, COUNT(*) AS pt FROM bb_visits WHERE day >= ? GROUP BY sharer_id').bind(sinceDay).all()).results;
  const map = new Map();
  const row = (id) => { if (!map.has(id)) map.set(id, { user_id: id, battles: 0, wins: 0, stake: 0, refund: 0, payout: 0, roi: null, races: 0, hits: 0, hit_rate: null, pt: 0 }); return map.get(id); };
  res.forEach((x) => { const r = row(x.user_id); r.battles = x.battles; r.wins = x.wins; r.stake = x.stake; r.refund = x.refund; r.payout = x.payout; const base = x.stake - x.refund; r.roi = base > 0 ? Math.round((x.payout / base) * 1000) / 10 : null; });
  hits.forEach((x) => { const r = row(x.user_id); r.races = x.races; r.hits = x.hits || 0; r.hit_rate = x.races > 0 ? Math.round(((x.hits || 0) / x.races) * 1000) / 10 : null; });
  pts.forEach((x) => { row(x.user_id).pt = x.pt; });
  return [...map.values()];
}

// ユーザーカード：その人の対戦数・勝ち数・集客pt（今月分と累計）。誰でも見られる
//   回収率と的中率は、プレミアムの人が見たときだけ付ける（ランキングと同じ扱い）
async function apiUserCard(request, env, userId) {
  const target = await env.DB.prepare('SELECT * FROM bb_users WHERE user_id = ?').bind(userId).first();
  if (!target || target.status === 'deleted') return json({ error: 'not_found' }, 404);
  const t = now();
  const monthStart = Math.floor(Date.parse(jstDate(t).slice(0, 8) + '01T00:00:00+09:00') / 1000);
  const monthDay = jstDate(t).slice(0, 8) + '01';
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS battles, SUM(CASE WHEN rr.rank = 1 AND ro.no_winner = 0 THEN 1 ELSE 0 END) AS wins,
            SUM(rr.stake) AS stake, SUM(rr.refund) AS refund, SUM(rr.payout) AS payout,
            SUM(CASE WHEN ro.finished_at >= ?1 THEN 1 ELSE 0 END) AS m_battles,
            SUM(CASE WHEN ro.finished_at >= ?1 AND rr.rank = 1 AND ro.no_winner = 0 THEN 1 ELSE 0 END) AS m_wins,
            SUM(CASE WHEN ro.finished_at >= ?1 THEN rr.stake ELSE 0 END) AS m_stake,
            SUM(CASE WHEN ro.finished_at >= ?1 THEN rr.refund ELSE 0 END) AS m_refund,
            SUM(CASE WHEN ro.finished_at >= ?1 THEN rr.payout ELSE 0 END) AS m_payout
       FROM bb_room_results rr JOIN bb_rooms ro ON ro.room_id = rr.room_id
      WHERE rr.user_id = ?2 AND ro.state = 'finished' AND ro.hidden = 0`
  ).bind(monthStart, userId).first();
  const pt = await env.DB.prepare(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN day >= ?1 THEN 1 ELSE 0 END) AS month FROM bb_visits WHERE sharer_id = ?2'
  ).bind(monthDay, userId).first();
  const out = {
    user: publicUser(target),
    month: { battles: r.m_battles || 0, wins: r.m_wins || 0, pt: pt.month || 0 },
    total: { battles: r.battles || 0, wins: r.wins || 0, pt: pt.total || 0 },
  };
  const viewer = await currentUser(request, env);
  if ((await premiumUntil(request, env, viewer)) > t) {
    const roi = (stake, refund, payout) => (stake - refund > 0 ? Math.round((payout / (stake - refund)) * 1000) / 10 : null);
    out.month.roi = roi(r.m_stake || 0, r.m_refund || 0, r.m_payout || 0);
    out.total.roi = roi(r.stake || 0, r.refund || 0, r.payout || 0);
  }
  return json(out);
}

async function apiStats(request, env, url) {
  const period = url.searchParams.get('period') === 'all' ? 'all' : 'month';
  const user = await currentUser(request, env);
  const premium = (await premiumUntil(request, env, user)) > now();
  const rows = await buildStats(env, period);
  const byRoi = rows.filter((r) => r.roi !== null).sort((a, b) => b.roi - a.roi || b.payout - a.payout);
  if (!premium) {
    // 名前やIDは送らない。回収率の上位3人の数字だけ
    return json({ locked: true, period, top: byRoi.slice(0, 3).map((r, i) => ({ rank: i + 1, roi: r.roi })) });
  }
  const ids = rows.map((r) => r.user_id).slice(0, 300);
  let users = [];
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    users = (await env.DB.prepare(`SELECT * FROM bb_users WHERE user_id IN (${marks})`).bind(...ids).all()).results;
  }
  const info = new Map(users.map((u) => [u.user_id, publicUser(u)]));
  return json({
    locked: false, period,
    users: rows.filter((r) => info.has(r.user_id)).map((r) => ({ ...r, ...info.get(r.user_id) })),
    history: await finishedRooms(env, '1 = 1', [], 30),          // 対戦の履歴（終了から12時間を過ぎたものも含む）
  });
}

// ---------------------------------------------------------------------
// ライブ中継
//   競輪場ごとに、公式YouTubeチャンネルのIDを持つ（管理画面で登録する）。
//   画面は、このIDを使って「そのチャンネルでいま配信中のライブ」を埋め込む。
//   配信していない時間帯や、チャンネル側が埋め込みを許可していない場合は、YouTube側の表示になる（こちらでは判別できない）。
// ---------------------------------------------------------------------
// ライブ中継の初期値：競輪場 → 公式YouTubeチャンネルのID（2026-10-05 調査）
//   出どころ：楽天Kドリームスの「競輪 ライブ映像一覧」（https://keirin.kdreams.jp/live/）の「YouTubeで視聴する」のリンク先。
//   確度  A … 一覧のリンクに、チャンネルIDがそのまま書かれていたもの
//         B … 一覧のリンクが名前の形だったので、そのチャンネルのページを読んでIDを確かめたもの
//         C … 一覧のリンク先と同じチャンネルかを直接確かめられていないもの、または中継の本体が別チャンネルの可能性があるもの
//   埋め込みで再生できるか（チャンネル側の許可）は、ここでは確かめていない。本番の画面で、競輪場ごとに確認する。
//   チャンネルは変わることがある（例：立川は2026年3月に中継のチャンネルが変わった）。変わったら、管理画面の「ライブ」で差し替える。
const LIVE_DEFAULTS = {
  hakodate: 'UC7Ehq9agmTeznt6XjZ5faLw',       // 函館（A）
  aomori: 'UCosOaqq60s3QAenTONNxUuQ',         // 青森（A）
  iwakidaira: 'UCTrT1fwMS9cOePzW_Z0TQfw',     // いわき平（B）
  yahiko: 'UCYOGwSM8IwydT0VLUKv5qKg',         // 弥彦（C）
  maebashi: 'UCtn0XkksabeXWF2Omyg6JEQ',       // 前橋（A）
  toride: 'UCDeV-cyqnTnoCCjz2Dm7VNA',         // 取手（C）
  utsunomiya: 'UCXKIA4ppNI_5lYFS3Eke39A',     // 宇都宮（B）
  omiya: 'UCjdy4VH5HnofysPTcqiwTdg',          // 大宮（B）
  seibuen: 'UCPqtPpQwwWArIS_zTl7A9XQ',        // 西武園（A）
  keiokaku: 'UCHdHXMKeFSZ3PxSUtpp90ng',       // 京王閣（B）
  tachikawa: 'UCvG1ViOoCDUqLrjbJsPhwzg',      // 立川（C）
  matsudo: 'UCEYoRewzhZWzP9OHaAFE8gA',        // 松戸（A）
  chiba: 'UCxehdZntrAfpHnaNGlg_WJQ',          // 千葉（A）
  kawasaki: 'UCtU7gR5VCpvQjtVPykL4EUA',       // 川崎（A）
  hiratsuka: 'UCvfTQBD1nQ8kAqwdrnTN-_g',      // 平塚（A）
  odawara: 'UCNgccovrnvwUqSBaqoqrtfA',        // 小田原（A）
  ito: 'UC3CT-xL9H2UW4PMA2Hg1FjA',            // 伊東（A）
  shizuoka: 'UCoPaxOy8ch2ydfgL1cpwhvQ',       // 静岡（B）
  nagoya: 'UCgf3cKAiLdTAset5YVGN4Rw',         // 名古屋（A）
  gifu: 'UCs2ed7DZGQ-YKsCOX6NGyZQ',           // 岐阜（C）
  ogaki: 'UCcDTb_mchV4oxxQ2CfGSHFA',          // 大垣（B）
  toyohashi: 'UC8mS4Ao44gjBbi8nFrP4fNg',      // 豊橋（A）
  toyama: 'UCvVIZOHj843xo_QSnjY62Lg',         // 富山（A）
  matsusaka: 'UCOZRGa_L_saD0ObvDtzG22Q',      // 松阪（A）
  yokkaichi: 'UCPibXjT_mINGifM1gi7ja0g',      // 四日市（A）
  fukui: 'UCypKxtT2sGParvK54JMeWfw',          // 福井（A）
  nara: 'UCAHgvI8-zib9yOA2suyjGcg',           // 奈良（B）
  mukomachi: 'UCdBuL72WRnKDIvAekxS2NxQ',      // 向日町（A）
  wakayama: 'UCu_WLHra6mfVBHj5qVz5Rbw',       // 和歌山（A）
  kishiwada: 'UChHOZZ-KJgahUia5vxQnvNw',      // 岸和田（C）
  tamano: 'UCiKs6agRQVxz1RRPHSX-Oaw',         // 玉野（A）
  hiroshima: 'UCC-MHu8wH3xWu8M93nzszBQ',      // 広島（A）
  hofu: 'UC42l0MgmrF_tIfaMAPVvUKA',           // 防府（A）
  takamatsu: 'UCWFvocB4sfX4wVXWaB4-SBg',      // 高松（A）
  komatsushima: 'UCnfVl6Q_xov3Wf45NdWE1Eg',   // 小松島（A）
  kochi: 'UCcnE1XfjoFEDL5GeWRk2DgQ',          // 高知（A）
  matsuyama: 'UCX3xb9FwC7jL_ZnVmoyzgDg',      // 松山（A）
  kokura: 'UCgOTgI9mi1XXYWs-J50FvHw',         // 小倉（C）
  kurume: 'UCh7mcNayAkEXneLmnFZwzbQ',         // 久留米（A）
  takeo: 'UClqmxHvzzOOWnpNdznfM28A',          // 武雄（A）
  sasebo: 'UCHsrH9sBqz9uDKggEKGsOFw',         // 佐世保（A）
  beppu: 'UCxUAWJYLRXK2GFl9Nz7lJXA',          // 別府（B）
  kumamoto: 'UCuhDz3wM73NDTg4IPMNlKhQ',       // 熊本（B）
};
const LIVE_OFF = '-';        // 管理画面で「使わない」にした競輪場の印（初期値も使わない）

const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;

// 対応表の読み取り（誰でも）。めったに変わらないので、端末側で5分使い回してよいと伝える
async function apiLive(env) {
  const rows = (await env.DB.prepare('SELECT venue_id, channel_id FROM bb_venue_live').all()).results;
  const live = { ...LIVE_DEFAULTS };
  rows.forEach((r) => {
    if (!VENUE_IDS.has(r.venue_id)) return;
    if (r.channel_id === LIVE_OFF) delete live[r.venue_id];              // 使わない
    else if (CHANNEL_RE.test(r.channel_id)) live[r.venue_id] = r.channel_id;   // 管理画面で登録したもの（初期値より優先）
  });
  return json({ live }, 200, { 'Cache-Control': 'public, max-age=300' });
}

// 入力された文字（チャンネルID、チャンネルのアドレス、動画のアドレス）から、チャンネルIDを割り出す
//   チャンネルIDそのもの、または /channel/UC… を含むアドレスは、そのまま使う。
//   それ以外のYouTubeのアドレス（@名前、動画、ライブ）は、そのページを取りに行って、中に書かれているチャンネルIDを読む。
//   YouTube以外のアドレスは受け付けない。
async function resolveChannel(env, input) {
  const text = String(input || '').trim();
  if (CHANNEL_RE.test(text)) return text;
  let u;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text); } catch (e) { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be') return null;
  const direct = u.pathname.match(/\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/|$)/);
  if (direct) return direct[1];
  // ページを取りに行く（検証用に、取りに行く先を設定 SRC_YOUTUBE で差し替えられる）
  const base = (env.SRC_YOUTUBE || 'https://www.youtube.com').replace(/\/$/, '');
  const target = host === 'youtu.be' ? `${base}/watch?v=${encodeURIComponent(u.pathname.slice(1))}` : base + u.pathname + u.search;
  const res = await fetchSource(target);
  if (!res.ok || !res.text) return null;
  const m = res.text.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/) || res.text.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/)
    || res.text.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------
// 管理画面用の窓口（/bb/api/admin/…）
//   使えるのは管理者だけ（設定 ADMIN_HANDLES に書いたXのIDでログインしている人）。
//   変更を伴う操作は、誰がいつ何をしたかを管理操作の記録に残す。
// ---------------------------------------------------------------------
const ADMIN_LIST = 50;         // 一覧で返す件数
const STUCK_AFTER = 1800;      // 発走からこの秒数を過ぎても結果がないレースを「止まっている」とみなす

async function adminLog(env, user, action, target, note) {
  await env.DB.prepare('INSERT INTO bb_admin_log (at, action, target, note) VALUES (?,?,?,?)')
    .bind(now(), action, String(target), JSON.stringify({ by: user.user_id, handle: user.handle, ...(note || {}) })).run();
}

async function adminRoute(request, env, url, path, method) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'login_required' }, 401);
  if (!isAdmin(env, user)) return json({ error: 'forbidden' }, 403);
  const t = now();

  // ---- 全体の数
  if (method === 'GET' && path === 'summary') {
    const rooms = (await env.DB.prepare(`SELECT state, hidden, COUNT(*) AS n FROM bb_rooms GROUP BY state, hidden`).all()).results;
    const users = (await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM bb_users GROUP BY status`).all()).results;
    const stuck = await env.DB.prepare(
      `SELECT COUNT(DISTINCT e.race_key) AS n FROM bb_entries e JOIN bb_races r ON r.race_key = e.race_key
        LEFT JOIN bb_race_results x ON x.race_key = e.race_key
       WHERE e.status = 'submitted' AND x.race_key IS NULL AND r.start_at IS NOT NULL AND r.start_at <= ?`
    ).bind(t - STUCK_AFTER).first();
    const comments = await env.DB.prepare('SELECT COUNT(*) AS n FROM bb_comments WHERE hidden = 0').first();
    return json({ rooms, users, stuck_races: stuck.n, comments: comments.n });
  }

  // ---- バトルルームの一覧（削除したものも含む。新しい順）
  if (method === 'GET' && path === 'rooms') {
    const rows = (await env.DB.prepare(
      `SELECT ro.room_id, ro.state, ro.hidden, ro.created_at, ro.battle_date, ro.race_count, ro.stake, ro.bet_types, ro.mode,
              u.handle AS creator_handle, u.display_name AS creator_name,
              (SELECT COUNT(*) FROM bb_members m WHERE m.room_id = ro.room_id) AS members,
              (SELECT COUNT(*) FROM bb_entries e WHERE e.room_id = ro.room_id AND e.status != 'no_vote') AS entries
         FROM bb_rooms ro LEFT JOIN bb_users u ON u.user_id = ro.creator_id
        ORDER BY ro.created_at DESC LIMIT ?`
    ).bind(ADMIN_LIST).all()).results;
    return json({ rooms: rows.map((r) => ({ ...r, hidden: !!r.hidden })) });
  }
  let m = path.match(/^rooms\/([A-Za-z0-9]{6,24})\/(hide|restore)$/);
  if (method === 'POST' && m) {
    const room = await env.DB.prepare('SELECT room_id, hidden, state FROM bb_rooms WHERE room_id = ?').bind(m[1]).first();
    if (!room) return json({ error: 'not_found' }, 404);
    const hide = m[2] === 'hide';
    await env.DB.prepare('UPDATE bb_rooms SET hidden = ? WHERE room_id = ?').bind(hide ? 1 : 0, m[1]).run();
    await adminLog(env, user, hide ? 'room_delete' : 'room_restore', m[1], { role: 'admin', state: room.state });
    return json({ ok: true });
  }

  // ---- 予想屋（ログインしたことがある人）の一覧。q を付けると、XのIDの前方一致で探す
  if (method === 'GET' && path === 'users') {
    const q = (url.searchParams.get('q') || '').replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
    const rows = (await env.DB.prepare(
      `SELECT u.user_id, u.handle, u.x_name, u.display_name, u.icon_url, u.status, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM bb_members m WHERE m.user_id = u.user_id) AS rooms,
              (SELECT COUNT(*) FROM bb_comments c WHERE c.user_id = u.user_id AND c.hidden = 0) AS comments
         FROM bb_users u WHERE (? = '' OR u.handle LIKE ? COLLATE NOCASE)
        ORDER BY u.last_login_at DESC LIMIT ?`
    ).bind(q, q + '%', ADMIN_LIST).all()).results;
    return json({ users: rows.map((r) => ({ ...r, is_admin: isAdmin(env, r) })) });
  }
  m = path.match(/^users\/([A-Za-z0-9]{16})\/status$/);
  if (method === 'POST' && m) {
    const b = await readBody(request);
    const status = b && b.status;
    if (status !== 'active' && status !== 'suspended') return json({ error: 'invalid', field: 'status' }, 400);
    const target = await env.DB.prepare('SELECT user_id, handle, status FROM bb_users WHERE user_id = ?').bind(m[1]).first();
    if (!target || target.status === 'deleted') return json({ error: 'not_found' }, 404);
    if (status === 'suspended' && isAdmin(env, { ...target, status: 'active' })) return json({ error: 'forbidden', reason: 'admin' }, 403);   // 管理者は利用停止にできない
    await env.DB.prepare('UPDATE bb_users SET status = ? WHERE user_id = ?').bind(status, m[1]).run();
    await adminLog(env, user, status === 'suspended' ? 'user_suspend' : 'user_resume', m[1], { target_handle: target.handle });
    return json({ ok: true });
  }

  // ---- コメントの一覧（削除したものも含む。新しい順）
  if (method === 'GET' && path === 'comments') {
    const rows = (await env.DB.prepare(
      `SELECT c.comment_id, c.room_id, c.user_id, c.body, c.created_at, c.hidden, u.handle, u.x_name
         FROM bb_comments c JOIN bb_users u ON u.user_id = c.user_id ORDER BY c.comment_id DESC LIMIT ?`
    ).bind(ADMIN_LIST).all()).results;
    return json({ comments: rows.map((r) => ({ ...r, hidden: !!r.hidden })) });
  }
  m = path.match(/^comments\/(\d{1,12})\/(hide|restore)$/);
  if (method === 'POST' && m) {
    const c = await env.DB.prepare('SELECT comment_id, room_id FROM bb_comments WHERE comment_id = ?').bind(Number(m[1])).first();
    if (!c) return json({ error: 'not_found' }, 404);
    const hide = m[2] === 'hide';
    await env.DB.prepare('UPDATE bb_comments SET hidden = ?, hidden_by = ? WHERE comment_id = ?').bind(hide ? 1 : 0, hide ? user.user_id : null, c.comment_id).run();
    await adminLog(env, user, hide ? 'comment_hide' : 'comment_restore', c.comment_id, { role: 'admin', room: c.room_id });
    return json({ ok: true });
  }

  // ---- 結果が出ないまま止まっているレース（発走から30分を過ぎても結果がないもの）
  if (method === 'GET' && path === 'races') {
    const rows = (await env.DB.prepare(
      `SELECT r.race_key, r.start_at, r.deadline_at, r.cancel, r.status,
              (SELECT COUNT(*) FROM bb_entries e WHERE e.race_key = r.race_key AND e.status = 'submitted') AS entries,
              (SELECT COUNT(DISTINCT e.room_id) FROM bb_entries e WHERE e.race_key = r.race_key) AS rooms
         FROM bb_races r
        WHERE r.start_at IS NOT NULL AND r.start_at <= ?
          AND NOT EXISTS (SELECT 1 FROM bb_race_results x WHERE x.race_key = r.race_key)
          AND (EXISTS (SELECT 1 FROM bb_entries e WHERE e.race_key = r.race_key AND e.status = 'submitted')
               OR EXISTS (SELECT 1 FROM bb_room_races rr JOIN bb_rooms ro ON ro.room_id = rr.room_id WHERE rr.race_key = r.race_key AND ro.state = 'open' AND ro.hidden = 0))
        ORDER BY r.start_at LIMIT ?`
    ).bind(t - STUCK_AFTER, ADMIN_LIST).all()).results;
    return json({ races: rows });
  }
  m = path.match(/^races\/(\d{8}-[a-z0-9_]{1,24}-\d{1,2})\/(recheck|cancel)$/);
  if (method === 'POST' && m) {
    const key = m[1];
    const quota = { entries: TICK_ENTRIES };
    if (m[2] === 'recheck') {
      // 取得元をもう一度確かめる（使い回している内容を使わずに取り直すため、少し時間を空けて押す）
      const res = await settleRace(env, key, quota);
      await finalizeRooms(env);
      await adminLog(env, user, 'race_recheck', key, { result: res.status, reason: res.reason || null });
      return json({ ok: true, status: res.status, reason: res.reason || null, race_status: res.race_status ?? null });
    }
    // 中止として扱う：全額返還にして、判定を進める（特払いなどで結果が確定しないときの手当て）
    const exists = await env.DB.prepare('SELECT status FROM bb_race_results WHERE race_key = ?').bind(key).first();
    if (exists) return json({ error: 'already_settled', status: exists.status }, 409);
    const known = await env.DB.prepare('SELECT race_key FROM bb_races WHERE race_key = ?').bind(key).first();
    if (!known) return json({ error: 'not_found' }, 404);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO bb_race_results (race_key, status, order_json, payouts_json, scratched_json, fetched_at) VALUES (?, 'cancelled', '[]', '{}', '[]', ?)`
    ).bind(key, t).run();
    await settleEntries(env, key, quota);
    await finalizeRooms(env);
    await adminLog(env, user, 'race_force_cancel', key, {});
    return json({ ok: true, status: 'cancelled' });
  }

  // ---- 入場コード（いま有効なものと、最近のもの）と、noteの記事のアドレス
  if (method === 'GET' && path === 'codes') {
    const rows = (await env.DB.prepare('SELECT code_id, kind, code, valid_from, valid_until, note_url FROM bb_codes ORDER BY valid_until DESC, code_id DESC LIMIT 20').all()).results;
    return json({ codes: rows.map((r) => ({ ...r, active: r.valid_from <= t && r.valid_until > t })), note_url: await currentNoteUrl(env), now: t });
  }
  if (method === 'POST' && path === 'codes') {
    const b = await readBody(request);
    const kind = b && b.kind, code = String((b && b.code) || '');
    if (kind !== 'bb' && kind !== 'brain') return json({ error: 'invalid', field: 'kind' }, 400);
    if (!/^\d{4}$/.test(code)) return json({ error: 'invalid', field: 'code' }, 400);
    // 期限：日付（その日の終わりまで有効）で指定。省略したときは、bb は10日後、brain は今月の末日
    let until;
    if (b.until) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.until)) return json({ error: 'invalid', field: 'until' }, 400);
      until = Math.floor(Date.parse(b.until + 'T23:59:59+09:00') / 1000) + 1;
    } else if (kind === 'bb') {
      until = Math.floor(Date.parse(jstDate(t + 10 * 86400) + 'T23:59:59+09:00') / 1000) + 1;
    } else {
      const [y, mo] = jstDate(t).split('-').map(Number);
      until = Math.floor(Date.parse(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01T00:00:00+09:00`) / 1000);
    }
    if (!(until > t)) return json({ error: 'invalid', field: 'until' }, 400);
    // このコードを販売しているnoteの記事のアドレス（BattleBank専用のコードだけ。Brainのコードには付けない）
    const note = kind === 'bb' ? String(b.note_url || '').trim().slice(0, 300) : '';
    if (note && !NOTE_URL_RE.test(note)) return json({ error: 'invalid', field: 'note_url' }, 400);
    await env.DB.prepare('INSERT INTO bb_codes (kind, code, valid_from, valid_until, created_at, created_by, note_url) VALUES (?,?,?,?,?,?,?)')
      .bind(kind, code, t, until, t, user.user_id, note || null).run();
    await adminLog(env, user, 'code_add', kind, { until, note: !!note });
    return json({ ok: true, until, note_url: note || null }, 201);
  }
  // 登録済みのコードの、noteの記事のアドレスだけを変える
  m = path.match(/^codes\/(\d{1,10})\/note$/);
  if (method === 'POST' && m) {
    const b = await readBody(request);
    const note = String((b && b.note_url) || '').trim().slice(0, 300);
    if (note && !NOTE_URL_RE.test(note)) return json({ error: 'invalid', field: 'note_url' }, 400);
    const r = await env.DB.prepare(`UPDATE bb_codes SET note_url = ? WHERE code_id = ? AND kind = 'bb'`).bind(note || null, Number(m[1])).run();
    if (!r.meta || !r.meta.changes) return json({ error: 'not_found' }, 404);
    await adminLog(env, user, 'code_note', m[1], {});
    return json({ ok: true });
  }
  m = path.match(/^codes\/(\d{1,10})\/expire$/);
  if (method === 'POST' && m) {
    const r = await env.DB.prepare('UPDATE bb_codes SET valid_until = ? WHERE code_id = ? AND valid_until > ?').bind(t, Number(m[1]), t).run();
    if (!r.meta || !r.meta.changes) return json({ error: 'not_found' }, 404);
    await adminLog(env, user, 'code_expire', m[1], {});
    return json({ ok: true });
  }
  if (method === 'POST' && path === 'settings') {
    const b = await readBody(request);
    const note = String((b && b.note_url) || '').trim().slice(0, 300);
    if (note && !NOTE_URL_RE.test(note)) return json({ error: 'invalid', field: 'note_url' }, 400);
    await setSetting(env, 'note_url', note || null);
    await adminLog(env, user, 'setting_note', 'note_url', {});
    return json({ ok: true });
  }

  // ---- ライブ中継の対応表（全競輪場。未登録のものも含む）
  if (method === 'GET' && path === 'live') {
    const rows = new Map((await env.DB.prepare('SELECT venue_id, channel_id, source, updated_at FROM bb_venue_live').all()).results.map((r) => [r.venue_id, r]));
    // origin：default（初期値のまま）／custom（管理画面で登録）／off（使わない）／none（初期値も登録もない）
    return json({ venues: [...VENUE_IDS].map((id) => {
      const r = rows.get(id), def = LIVE_DEFAULTS[id] || null;
      const off = !!r && r.channel_id === LIVE_OFF;
      const custom = !!r && CHANNEL_RE.test(r.channel_id);
      return {
        venue_id: id, default_id: def,
        channel_id: off ? null : custom ? r.channel_id : def,
        origin: off ? 'off' : custom ? 'custom' : def ? 'default' : 'none',
        source: custom ? r.source : null, updated_at: r ? r.updated_at : null,
      };
    }) });
  }
  m = path.match(/^live\/([a-z0-9_]{1,24})$/);
  if (method === 'POST' && m) {
    if (!VENUE_IDS.has(m[1])) return json({ error: 'not_found' }, 404);
    const b = await readBody(request);
    const input = String((b && b.input) || '').trim().slice(0, 300);
    if (b && b.off) {
      // 使わない：この競輪場の中継を出さない（初期値も使わない）
      await env.DB.prepare('INSERT OR REPLACE INTO bb_venue_live (venue_id, channel_id, source, updated_at, updated_by) VALUES (?,?,?,?,?)')
        .bind(m[1], LIVE_OFF, null, t, user.user_id).run();
      await adminLog(env, user, 'live_off', m[1], {});
      return json({ ok: true, channel_id: null, origin: 'off' });
    }
    if (!input) {
      // 空で登録：管理画面での登録（または「使わない」）を消して、初期値に戻す
      await env.DB.prepare('DELETE FROM bb_venue_live WHERE venue_id = ?').bind(m[1]).run();
      await adminLog(env, user, 'live_clear', m[1], {});
      return json({ ok: true, channel_id: LIVE_DEFAULTS[m[1]] || null, origin: LIVE_DEFAULTS[m[1]] ? 'default' : 'none' });
    }
    const channel = await resolveChannel(env, input);
    if (!channel) return json({ error: 'resolve_failed' }, 400);
    await env.DB.prepare('INSERT OR REPLACE INTO bb_venue_live (venue_id, channel_id, source, updated_at, updated_by) VALUES (?,?,?,?,?)')
      .bind(m[1], channel, input, t, user.user_id).run();
    await adminLog(env, user, 'live_set', m[1], { channel });
    return json({ ok: true, channel_id: channel, origin: 'custom' });
  }

  // ---- 管理操作の記録（新しい順）
  if (method === 'GET' && path === 'log') {
    const rows = (await env.DB.prepare('SELECT id AS log_id, at, action, target, note FROM bb_admin_log ORDER BY id DESC LIMIT ?').bind(ADMIN_LIST).all()).results;
    return json({ log: rows.map((r) => { let note = {}; try { note = JSON.parse(r.note || '{}'); } catch (e) { note = {}; } return { ...r, note }; }) });
  }
  return json({ error: 'not_found' }, 404);
}

// ---------------------------------------------------------------------
// コメント
//   書ける人：Xでログインしている人（予想屋もギャラリーも）。利用停止中の人は書けない
//   書ける場面：成立したバトルルームと、終了したバトルルーム
//   名前の出し方：そのバトルルームの予想屋（作成者・参加者）は、自分で決めた表示名と「予想屋」の印。
//                 ギャラリーは、Xの名前と@IDをそのまま（変更できない）
//   荒らし対策：1件140文字まで。同じ人は5秒に1件まで、10分に30件まで
//   削除：書いた本人と管理者。削除したコメントは行を残したまま非表示にする
// ---------------------------------------------------------------------
const COMMENT_MAX = 140;          // 1件の文字数の上限
const COMMENT_GAP = 5;            // 同じ人が続けて書けるまでの秒数
const COMMENT_BURST = 30;         // 同じ人が10分間に書ける件数
const COMMENT_SHOWN = 50;         // 画面に返す件数（新しい順に、この件数まで）

// バトルルームのコメントの一覧（古い順）。viewer は、削除の印を付けるために使う
async function loadComments(env, room, members, viewer) {
  const rows = (await env.DB.prepare(
    `SELECT c.comment_id, c.user_id, c.body, c.created_at, u.handle, u.x_name, u.display_name, u.icon_url, u.status
       FROM bb_comments c JOIN bb_users u ON u.user_id = c.user_id
      WHERE c.room_id = ? AND c.hidden = 0 ORDER BY c.comment_id DESC LIMIT ?`
  ).bind(room.room_id, COMMENT_SHOWN).all()).results.reverse();
  const memberIds = new Set(members.map((m) => m.user_id));
  const creatorIds = new Set(members.filter((m) => m.is_creator).map((m) => m.user_id));
  const admin = isAdmin(env, viewer);
  return rows.map((c) => {
    const pro = memberIds.has(c.user_id);
    return {
      role: creatorIds.has(c.user_id) ? 'creator' : pro ? 'member' : null,       // このバトルルームでの立場
      id: c.comment_id, user_id: c.user_id, handle: c.handle, icon_url: c.icon_url,
      // 予想屋は表示名、ギャラリーはXの名前
      name: pro ? (c.display_name || c.x_name) : (c.x_name || c.display_name),
      pro, body: c.body, at: c.created_at,
      can_hide: !!viewer && (admin || viewer.user_id === c.user_id),
    };
  });
}

async function apiPostComment(request, env, roomId) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'login_required' }, 401);
  if (user.status !== 'active') return json({ error: 'suspended' }, 403);
  const room = await loadRoom(env, roomId);
  if (!room) return json({ error: 'not_found' }, 404);
  if (room.state !== 'open' && room.state !== 'finished') return json({ error: 'not_open' }, 409);
  const b = await readBody(request);
  // 制御文字を除き、前後の空白を取る。改行は空白1つにする
  const body = String((b && b.body) || '').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!body) return json({ error: 'invalid', field: 'body', reason: 'empty' }, 400);
  if ([...body].length > COMMENT_MAX) return json({ error: 'invalid', field: 'body', reason: 'too_long' }, 400);
  const t = now();
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM bb_comments WHERE user_id = ? AND created_at > ?'
  ).bind(user.user_id, t - 600).first();
  if (recent.last && t - recent.last < COMMENT_GAP) return json({ error: 'too_fast' }, 429);
  if (recent.n >= COMMENT_BURST) return json({ error: 'too_many' }, 429);
  const r = await env.DB.prepare('INSERT INTO bb_comments (room_id, user_id, body, created_at) VALUES (?,?,?,?)').bind(roomId, user.user_id, body, t).run();
  return json({ ok: true, id: r.meta && r.meta.last_row_id }, 201);
}

async function apiHideComment(request, env, roomId, commentId) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'login_required' }, 401);
  if (user.status !== 'active') return json({ error: 'suspended' }, 403);
  const c = await env.DB.prepare('SELECT comment_id, user_id, hidden FROM bb_comments WHERE comment_id = ? AND room_id = ?').bind(commentId, roomId).first();
  if (!c || c.hidden) return json({ error: 'not_found' }, 404);
  const admin = isAdmin(env, user);
  if (!admin && c.user_id !== user.user_id) return json({ error: 'forbidden' }, 403);
  await env.DB.batch([
    env.DB.prepare('UPDATE bb_comments SET hidden = 1, hidden_by = ? WHERE comment_id = ?').bind(user.user_id, commentId),
    env.DB.prepare('INSERT INTO bb_admin_log (at, action, target, note) VALUES (?,?,?,?)')
      .bind(now(), 'comment_hide', String(commentId), JSON.stringify({ by: user.user_id, role: admin && c.user_id !== user.user_id ? 'admin' : 'author', room: roomId })),
  ]);
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// シェア用のアドレス（/bb/s/ルームID?p=節目&f=シェアした人）
//   Xなどに貼ったときの見出し（リンクカード）を、その時点の内容にするためのページ。
//   Xはカードの内容をアドレスごとに覚えるので、節目ごとに別のアドレスにしている。
//   人が開いたときは、すぐにバトルルームの画面へ移す（f と p は引き継ぐ。集客ptの記録に使う）。
//   見出しに入れる名前は、参加を承諾した人だけ。まだ応答していない招待相手の名前は入れない。
//   画像は、いまはサイト共通の画像。ルームごとのカード画像は、有料プランに切り替えてから差し替える。
// ---------------------------------------------------------------------
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BET_NAME = { '3t': '3連単', '3f': '3連複', '2t': '2車単' };

async function sharePage(url, env, roomId) {
  const f = url.searchParams.get('f'), ph = url.searchParams.get('p');
  const q = new URLSearchParams({ r: roomId });
  if (f && /^[A-Za-z0-9]{16}$/.test(f)) q.set('f', f);
  if (ph && /^[a-z0-9_]{1,16}$/.test(ph)) q.set('p', ph);
  const dest = `${env.SITE_ORIGIN}/?${q.toString()}`;

  let title = '競輪BattleBank', desc = '競輪予想屋どうしの予想バトルを、無料で観戦できます。';
  const room = await loadRoom(env, roomId);
  if (room) {
    const bet = BET_NAME[room.bet_types.split(',')[0]] || '';
    const rule = `${room.race_count}レース 各${room.stake.toLocaleString('ja-JP')}円 ${bet}`;
    const members = (await env.DB.prepare(
      `SELECT u.user_id, u.handle, u.display_name FROM bb_members m JOIN bb_users u ON u.user_id = m.user_id WHERE m.room_id = ? ORDER BY m.joined_at, m.rowid`
    ).bind(roomId).all()).results;
    const nameOf = (id) => { const m = members.find((x) => x.user_id === id); return m ? (m.display_name || (m.handle ? '@' + m.handle : '予想屋')) : '予想屋'; };
    const versus = members.length <= 3 ? members.map((m) => nameOf(m.user_id)).join(' vs ') : `${members.length}人のバトル`;
    desc = `${rule}｜観戦は無料・ログイン不要`;
    if (room.state === 'recruiting') title = room.recruit === 'open' ? `対戦相手 募集中（先着${Math.max(1, (room.capacity || 2) - 1)}名）｜${rule}` : `挑戦状｜${rule}`;
    else if (room.state === 'void') title = `不成立｜${rule}`;
    else {
      const entryRows = (await env.DB.prepare('SELECT * FROM bb_entries WHERE room_id = ?').bind(roomId).all()).results;
      const fixedKeys = (await env.DB.prepare('SELECT race_key FROM bb_room_races WHERE room_id = ? ORDER BY seq').bind(roomId).all()).results.map((r) => r.race_key);
      const keys = [...new Set([...fixedKeys, ...entryRows.map((e) => e.race_key)])];
      const doneKeys = new Set(), cancelledKeys = new Set();
      if (keys.length) {
        const marks = keys.map(() => '?').join(',');
        (await env.DB.prepare(`SELECT race_key, status FROM bb_race_results WHERE race_key IN (${marks})`).bind(...keys).all()).results
          .forEach((r) => { doneKeys.add(r.race_key); if (r.status === 'cancelled') cancelledKeys.add(r.race_key); });
      }
      const st = tally(room, members, fixedKeys, entryRows, doneKeys, cancelledKeys, room.state === 'finished');
      const draw = st.every((x) => x.rank === 1);
      if (room.state === 'finished') {
        title = draw ? `決着｜勝者なし｜${versus}` : `決着｜${st.filter((x) => x.rank === 1).map((x) => nameOf(x.user_id)).join('・')} の勝ち 回収率${st[0].roi}%`;
      } else if (doneKeys.size > 0 && st[0].roi !== null && !draw) {
        title = `途中結果｜${nameOf(st[0].user_id)} が回収率${st[0].roi}%でトップ`;
      } else {
        title = `対戦決定｜${versus}`;
      }
    }
  }
  const image = `${env.SITE_ORIGIN}/ogp.jpeg`;
  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escHtml(title)}｜競輪BattleBank</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="競輪BattleBank">
<meta property="og:title" content="${escHtml(title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:url" content="${escHtml(url.origin + url.pathname + url.search)}">
<meta property="og:image" content="${escHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escHtml(title)}">
<meta name="twitter:description" content="${escHtml(desc)}">
<meta name="twitter:image" content="${escHtml(image)}">
<meta http-equiv="refresh" content="0;url=${escHtml(dest)}">
</head><body style="font-family:sans-serif;background:#f4f4f6;color:#2e2f37;text-align:center;padding:40px 16px;">
<p>競輪BattleBank を開いています…</p>
<p><a href="${escHtml(dest)}">開かないときは、ここを押してください</a></p>
<script>location.replace(${JSON.stringify(dest).replace(/</g, '\\u003c')});</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
}

// ---------------------------------------------------------------------
// バトルルームの削除
//   削除できる人
//     管理者（設定 ADMIN_HANDLES に書いたXのIDでログインしている人）：どのバトルルームも、いつでも
//     作成者：まだ誰も投票していないバトルルームだけ（投票が入った後は、勝敗の記録を消せないようにするため）
//   削除したバトルルームは、データを残したまま非表示にする（一覧にも出ず、リンクを開いても「見つかりません」になる）。
//   誰がいつ削除したかを、管理操作の記録に残す。
// ---------------------------------------------------------------------
function isAdmin(env, user) {
  if (!user || user.status !== 'active' || !user.handle) return false;
  const list = String(env.ADMIN_HANDLES || '').split(',').map((x) => x.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
  return list.includes(String(user.handle).toLowerCase());
}

async function apiDeleteRoom(request, env, roomId) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'login_required' }, 401);
  if (user.status !== 'active') return json({ error: 'suspended' }, 403);
  const room = await loadRoom(env, roomId);
  if (!room) return json({ error: 'not_found' }, 404);
  const admin = isAdmin(env, user);
  const creator = room.creator_id === user.user_id;
  if (!admin && !creator) return json({ error: 'forbidden' }, 403);
  if (!admin) {
    const voted = await env.DB.prepare(`SELECT COUNT(*) AS n FROM bb_entries WHERE room_id = ? AND status != 'no_vote'`).bind(roomId).first();
    if (voted.n > 0) return json({ error: 'has_entries' }, 409);
  }
  const t = now();
  await env.DB.batch([
    env.DB.prepare('UPDATE bb_rooms SET hidden = 1 WHERE room_id = ?').bind(roomId),
    env.DB.prepare('INSERT INTO bb_admin_log (at, action, target, note) VALUES (?,?,?,?)')
      .bind(t, 'room_delete', roomId, JSON.stringify({ by: user.user_id, handle: user.handle, role: admin ? 'admin' : 'creator', state: room.state })),
  ]);
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// 流入の記録（集客pt）
//   予想屋のリンク（?f=予想屋のID）からバトルルームが開かれたとき、画面から呼ばれる。
//   数える条件：リンクの持ち主がそのルームの作成者・参加者であること
//   数えない場合：同じ来場者の2回目以降／リンクの持ち主本人／そのルームの作成者・参加者／同じ接続元からの上限超え
//   数えたかどうかは応答に含めない（水増しの手がかりを与えないため）
// ---------------------------------------------------------------------
async function apiVisit(request, env, roomId) {
  const b = await readBody(request);
  const from = b && typeof b.from === 'string' ? b.from : '';
  if (!/^[A-Za-z0-9]{16}$/.test(from)) return json({ error: 'invalid', field: 'from' }, 400);
  const phase = b && typeof b.phase === 'string' && /^[a-z0-9_]{1,16}$/.test(b.phase) ? b.phase : null;

  const room = await env.DB.prepare('SELECT room_id, state, hidden FROM bb_rooms WHERE room_id = ?').bind(roomId).first();
  if (!room || room.hidden) return json({ error: 'not_found' }, 404);

  // 来場者の番号（なければ発行する）
  let vid = readCookie(request, VISITOR_COOKIE);
  const headers = {};
  if (!vid || !/^[A-Za-z0-9]{24}$/.test(vid)) {
    vid = rid(24);
    headers['Set-Cookie'] = `${VISITOR_COOKIE}=${vid}; Path=${BASE}; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
  }
  const done = () => json({ ok: true }, 200, headers);
  if (room.state === 'void') return done();

  const members = (await env.DB.prepare('SELECT user_id FROM bb_members WHERE room_id = ?').bind(roomId).all()).results
    .map((m) => m.user_id);
  if (!members.includes(from)) return done();                     // リンクの持ち主が、このルームの予想屋ではない

  const user = await currentUser(request, env);
  if (user && members.includes(user.user_id)) return done();      // 本人、またはこのルームの予想屋

  const t = now();
  const day = jstDate(t);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  let ipHash = null;
  if (ip) {
    ipHash = (await sha256b64url(`${ip}|${roomId}|${day}|${env.X_CLIENT_SECRET}`)).slice(0, 22);
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM bb_visits WHERE room_id = ? AND ip_hash = ? AND day = ?')
      .bind(roomId, ipHash, day).first();
    if (used.n >= VISIT_CAP_PER_IP) return done();
  }
  await env.DB.prepare(
    `INSERT OR IGNORE INTO bb_visits (room_id, visitor_id, sharer_id, phase, ip_hash, day, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(roomId, vid, from, phase, ipHash, day, t).run();
  return done();
}

// ---------------------------------------------------------------------
// 招待への応答（参加／辞退）と成立判定
// ---------------------------------------------------------------------
async function apiRespond(request, env, roomId, accept) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: 'login_required' }, 401);
  if (user.status !== 'active') return json({ error: 'suspended' }, 403);
  const room = await loadRoom(env, roomId);
  if (!room) return json({ error: 'not_found' }, 404);

  const t = now();
  if (room.state !== 'recruiting' && room.state !== 'open') return json({ error: 'closed' }, 409);
  if (t >= room.join_deadline) return json({ error: 'deadline_passed' }, 409);

  // 相手をランダムに募集しているバトルルーム：招待は要らない。空きがあれば、先着順で参加できる
  if (room.recruit === 'open') {
    if (!accept) return json({ error: 'invalid' }, 400);
    if (room.state === 'open' && room.quorum !== 'two_plus') return json({ error: 'closed' }, 409);
    const already = await env.DB.prepare('SELECT 1 AS x FROM bb_members WHERE room_id = ? AND user_id = ?').bind(roomId, user.user_id).first();
    if (already) return json({ error: 'already_member' }, 409);
    // 定員を超えないように、人数の確認と追加を1つの文で行う（同時に押されても、定員までしか入らない）
    const ins = await env.DB.prepare(
      `INSERT INTO bb_members (room_id, user_id, is_creator, joined_at)
       SELECT ?1, ?2, 0, ?3 WHERE (SELECT COUNT(*) FROM bb_members WHERE room_id = ?1) < ?4`
    ).bind(roomId, user.user_id, t, room.capacity || 0).run();
    if (!ins.meta || !ins.meta.changes) return json({ error: 'full' }, 409);
    let st = room.state;
    if (room.state === 'recruiting') {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM bb_members WHERE room_id = ?').bind(roomId).first();
      // 2人以上で成立：最初の1人が参加した時点。全員が揃って成立：定員に達した時点
      if (room.quorum === 'two_plus' || n.n >= (room.capacity || 0)) {
        await env.DB.prepare(`UPDATE bb_rooms SET state = 'open', established_at = ? WHERE room_id = ? AND state = 'recruiting'`).bind(t, roomId).run();
        st = 'open';
      }
    }
    return json({ ok: true, state: st });
  }

  const handle = (user.handle || '').toLowerCase();
  const invite = await env.DB.prepare('SELECT * FROM bb_invites WHERE room_id = ? AND handle = ?')
    .bind(roomId, handle).first();
  if (!invite) return json({ error: 'not_invited' }, 403);
  if (invite.status !== 'pending') return json({ error: 'already_responded', status: invite.status }, 409);

  if (!accept) {
    const stmts = [
      env.DB.prepare(
        `UPDATE bb_invites SET status = 'declined', user_id = ?, responded_at = ?
          WHERE room_id = ? AND handle = ? AND status = 'pending'`
      ).bind(user.user_id, t, roomId, handle),
    ];
    // 「全員が揃って成立」の部屋は、1人でも辞退した時点で成立しなくなるため不成立にする
    let state = room.state;
    if (room.quorum === 'all' && room.state === 'recruiting') {
      stmts.push(env.DB.prepare(`UPDATE bb_rooms SET state = 'void' WHERE room_id = ? AND state = 'recruiting'`).bind(roomId));
      stmts.push(env.DB.prepare(`UPDATE bb_invites SET status = 'expired' WHERE room_id = ? AND status = 'pending' AND handle != ?`).bind(roomId, handle));
      state = 'void';
    }
    await env.DB.batch(stmts);
    return json({ ok: true, state });
  }

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM bb_members WHERE room_id = ?').bind(roomId).first();
  if (count.n >= MAX_MEMBERS) return json({ error: 'full' }, 409);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE bb_invites SET status = 'accepted', user_id = ?, responded_at = ?
        WHERE room_id = ? AND handle = ? AND status = 'pending'`
    ).bind(user.user_id, t, roomId, handle),
    env.DB.prepare('INSERT INTO bb_members (room_id, user_id, is_creator, joined_at) VALUES (?,?,0,?)')
      .bind(roomId, user.user_id, t),
  ]);

  // 成立判定
  //   全員が揃って成立 : 未応答の招待がなくなった時点
  //   2人以上で成立    : 最初の1人が参加した時点（作成者と合わせて2人）
  let state = room.state;
  if (room.state === 'recruiting') {
    let established = room.quorum === 'two_plus';
    if (room.quorum === 'all') {
      const rest = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM bb_invites WHERE room_id = ? AND status != 'accepted'`
      ).bind(roomId).first();
      established = rest.n === 0;
    }
    if (established) {
      await env.DB.prepare(
        `UPDATE bb_rooms SET state = 'open', established_at = ? WHERE room_id = ? AND state = 'recruiting'`
      ).bind(t, roomId).run();
      state = 'open';
    }
  }
  return json({ ok: true, state });
}
