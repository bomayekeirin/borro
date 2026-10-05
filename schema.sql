-- =====================================================================
-- 競輪BattleBank データベース定義  v10（2026-10-05）
-- v3の変更：開催の一覧（bb_cups）を追加／レース情報（bb_races）に「中止」「状態」を追加
-- v4の変更（2026-10-05）：投稿（bb_entries）に、入力したフォーメーションの一覧を追加
-- v5の変更（2026-10-05）：コメント（bb_comments）を追加
-- v6の変更（2026-10-05）：開催の一覧（bb_cups）に、時間帯と、その日の開催が終わったかどうかを追加
-- v7の変更（2026-10-05）：競輪場ごとのライブ中継（YouTubeのチャンネル）の対応表（bb_venue_live）を追加
-- v8の変更（2026-10-05）：プレミアムの入場コード（bb_codes）、設定（bb_settings）、コードの入力失敗の記録（bb_code_fails）を追加
-- v9の変更（2026-10-05）：入場コード（bb_codes）に、そのコードを販売しているnoteの記事のアドレスを追加
-- v10の変更（2026-10-05）：バトルルーム（bb_rooms）に、相手の決め方（指定／ランダムに募集）と定員を追加
-- v2の変更：予想屋に「Xの名前」と将来の有料バッジ用の項目を追加／流入の記録（bb_visits）を追加（bb_share_hits を置き換え）／月間成績に集客ptを追加
-- 用語：サービス名＝競輪BattleBank、1つ1つのバトルの場＝バトルルーム（表の名前の room はバトルルームのこと）
-- 対象: Cloudflare D1（SQLite）。
-- ※この表は、Worker（worker.js）が最初のアクセス時に自動で作る。D1のコンソールで実行する必要はない。
--   このファイルは、表の内容を確認するための控え。worker.js の中の定義と同じ内容にしておくこと。
-- 時刻はすべて UNIX秒（整数）。金額はすべて円（整数）。
-- =====================================================================

-- ---------- 予想屋 ----------
-- user_id は内部ID。Xの不変ID(x_user_id)は属性として持つ。
-- 削除申請時は x_user_id / handle / x_name / display_name / icon_url を空にし status='deleted' にする。
-- 部屋や買い目は user_id を参照するので、対戦相手の記録は欠けない。
CREATE TABLE IF NOT EXISTS bb_users (
  user_id       TEXT PRIMARY KEY,
  x_user_id     TEXT UNIQUE,
  handle        TEXT,
  x_name        TEXT,                          -- Xの名前（ログインのたびに更新）。ギャラリーとしてのコメント表示に使う
  display_name  TEXT,                          -- 自分で決めた表示名。自分が予想屋であるバトルルームの中で使う
  icon_url      TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','deleted')),
  premium_until INTEGER,                       -- 将来の有料バッジの有効期限（未使用。決済の機能はまだない）
  hide_pt       INTEGER NOT NULL DEFAULT 0,    -- 将来の有料バッジ用：集客ptを隠すかどうか（未使用）
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bb_users_handle ON bb_users(handle);

-- ---------- ログイン状態 ----------
CREATE TABLE IF NOT EXISTS bb_sessions (
  session_id  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES bb_users(user_id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bb_sessions_user ON bb_sessions(user_id);

-- ---------- Xログイン手続き中の一時情報 ----------
CREATE TABLE IF NOT EXISTS bb_oauth_states (
  state          TEXT PRIMARY KEY,
  code_verifier  TEXT NOT NULL,
  return_to      TEXT,
  created_at     INTEGER NOT NULL
);

-- ---------- 部屋 ----------
CREATE TABLE IF NOT EXISTS bb_rooms (
  room_id         TEXT PRIMARY KEY,
  creator_id      TEXT NOT NULL REFERENCES bb_users(user_id),
  state           TEXT NOT NULL DEFAULT 'recruiting'
                  CHECK (state IN ('recruiting','open','finished','void')),
  battle_date     TEXT NOT NULL,                 -- 開催日 YYYY-MM-DD（日本時間）
  race_count      INTEGER NOT NULL CHECK (race_count >= 1),
  mode            TEXT NOT NULL CHECK (mode IN ('fixed','free')),   -- 指定 / 任意
  stake           INTEGER NOT NULL
                  CHECK (stake IN (1000,1500,2000,3000,5000,10000,15000)),
  bet_types       TEXT NOT NULL,                 -- '3t' '3f' '2t' をカンマ区切り
  reveal_mode     TEXT NOT NULL CHECK (reveal_mode IN ('instant','before_start')),
  reveal_minutes  INTEGER,                       -- before_start のとき発走の何分前か
  quorum          TEXT NOT NULL CHECK (quorum IN ('all','two_plus')),
  join_deadline   INTEGER NOT NULL,              -- 参加締切
  created_at      INTEGER NOT NULL,
  established_at  INTEGER,                       -- 成立日時
  finished_at     INTEGER,                       -- 終了日時
  public_until    INTEGER,                       -- 非会員に見せる期限（終了＋12時間）
  no_winner       INTEGER NOT NULL DEFAULT 0,    -- 全員同点（勝者なし）
  hidden          INTEGER NOT NULL DEFAULT 0,    -- 管理による非表示
  recruit         TEXT NOT NULL DEFAULT 'invite',-- 相手の決め方：invite（XのIDで指定して招待）／open（ランダムに募集。先着順で誰でも参加できる）
  capacity        INTEGER                        -- 定員（作成者を含む人数）。ランダムに募集するときだけ使う
);
CREATE INDEX IF NOT EXISTS idx_bb_rooms_state_date ON bb_rooms(state, battle_date);
CREATE INDEX IF NOT EXISTS idx_bb_rooms_creator ON bb_rooms(creator_id);

-- ---------- 指定モードの対象レース ----------
CREATE TABLE IF NOT EXISTS bb_room_races (
  room_id   TEXT NOT NULL REFERENCES bb_rooms(room_id),
  seq       INTEGER NOT NULL,
  race_key  TEXT NOT NULL,
  PRIMARY KEY (room_id, seq),
  UNIQUE (room_id, race_key)
);

-- ---------- 招待 ----------
-- handle は小文字にそろえて保存。ログイン時の@IDと一致したら user_id を結びつける。
CREATE TABLE IF NOT EXISTS bb_invites (
  room_id       TEXT NOT NULL REFERENCES bb_rooms(room_id),
  handle        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','declined','expired')),
  user_id       TEXT REFERENCES bb_users(user_id),
  responded_at  INTEGER,
  PRIMARY KEY (room_id, handle)
);
CREATE INDEX IF NOT EXISTS idx_bb_invites_handle ON bb_invites(handle, status);

-- ---------- 参加者 ----------
CREATE TABLE IF NOT EXISTS bb_members (
  room_id     TEXT NOT NULL REFERENCES bb_rooms(room_id),
  user_id     TEXT NOT NULL REFERENCES bb_users(user_id),
  is_creator  INTEGER NOT NULL DEFAULT 0,
  joined_at   INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_bb_members_user ON bb_members(user_id);

-- ---------- レース情報（サーバーが自分で取得して保持） ----------
-- race_key の形式: YYYYMMDD-競輪場ID-レース番号
CREATE TABLE IF NOT EXISTS bb_races (
  race_key     TEXT PRIMARY KEY,
  race_date    TEXT NOT NULL,
  venue_id     TEXT NOT NULL,
  venue_name   TEXT NOT NULL,
  race_num     INTEGER NOT NULL,
  cup_code     TEXT,
  day_num      INTEGER,
  start_at     INTEGER,
  deadline_at  INTEGER,
  fetched_at   INTEGER NOT NULL,
  cancel       INTEGER NOT NULL DEFAULT 0,   -- 中止なら 1
  status       INTEGER                       -- 取得元の状態の番号（そのまま保存）
);
CREATE INDEX IF NOT EXISTS idx_bb_races_date ON bb_races(race_date);

-- ---------- 開催の一覧（サーバーが自分で取得して保持） ----------
-- その日に開催がある競輪場と、開催コード。venue_id が '_' の行は「この日の分を取得した」という印。
CREATE TABLE IF NOT EXISTS bb_cups (
  race_date   TEXT NOT NULL,     -- YYYY-MM-DD（日本時間）
  venue_id    TEXT NOT NULL,
  cup_code    TEXT NOT NULL,
  day_num     INTEGER,
  fetched_at  INTEGER NOT NULL,
  slot        TEXT,                         -- 時間帯：morning / day / nighter / midnight
  finished    INTEGER NOT NULL DEFAULT 0,   -- その日の開催が終わっていれば 1（取得元のリンクが結果のページになっている）
  PRIMARY KEY (race_date, venue_id)
);

-- ---------- 投稿（1人×1レース。訂正・削除の操作は用意しない） ----------
CREATE TABLE IF NOT EXISTS bb_entries (
  entry_id      TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES bb_rooms(room_id),
  user_id       TEXT NOT NULL REFERENCES bb_users(user_id),
  race_key      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted','settled','no_vote')),
  stake         INTEGER NOT NULL,              -- 投資額（＝部屋の固定額）
  refund        INTEGER NOT NULL DEFAULT 0,    -- 返還額
  payout        INTEGER NOT NULL DEFAULT 0,    -- 払戻額
  hit           INTEGER NOT NULL DEFAULT 0,    -- 的中あり=1
  ticket_count  INTEGER NOT NULL DEFAULT 0,    -- 買い目の点数
  submitted_at  INTEGER,
  settled_at    INTEGER,
  formations    TEXT,                          -- 入力したフォーメーションの一覧（JSON。例 ["4-26-1267","1-24-24"]）
  UNIQUE (room_id, user_id, race_key)
);
CREATE INDEX IF NOT EXISTS idx_bb_entries_user ON bb_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_bb_entries_race ON bb_entries(race_key, status);

-- ---------- 買い目（1点単位） ----------
-- combo: 3連単・2車単は着順どおり「4-5-6」。3連複は小さい順「4-5-6」。
CREATE TABLE IF NOT EXISTS bb_tickets (
  ticket_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id        TEXT NOT NULL REFERENCES bb_entries(entry_id),
  bet_type        TEXT NOT NULL CHECK (bet_type IN ('3t','3f','2t')),
  combo           TEXT NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0 AND amount % 100 = 0),
  odds_at_submit  REAL,                          -- 投稿時オッズ（参考）
  payout          INTEGER NOT NULL DEFAULT 0,    -- 確定払戻
  result          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (result IN ('pending','hit','miss','refund')),
  UNIQUE (entry_id, bet_type, combo)
);
CREATE INDEX IF NOT EXISTS idx_bb_tickets_entry ON bb_tickets(entry_id);

-- ---------- 結果と払戻（サーバーが自分で取得して保持） ----------
CREATE TABLE IF NOT EXISTS bb_race_results (
  race_key        TEXT PRIMARY KEY,
  status          TEXT NOT NULL CHECK (status IN ('settled','cancelled')),
  order_json      TEXT,     -- 着順
  payouts_json    TEXT,     -- 賭け式ごとの払戻
  scratched_json  TEXT,     -- 欠車
  fetched_at      INTEGER NOT NULL
);

-- ---------- 部屋の確定結果 ----------
CREATE TABLE IF NOT EXISTS bb_room_results (
  room_id   TEXT NOT NULL REFERENCES bb_rooms(room_id),
  user_id   TEXT NOT NULL REFERENCES bb_users(user_id),
  rank      INTEGER NOT NULL,
  stake     INTEGER NOT NULL,
  refund    INTEGER NOT NULL DEFAULT 0,
  payout    INTEGER NOT NULL DEFAULT 0,
  roi       REAL,           -- 回収率（％）
  PRIMARY KEY (room_id, user_id)
);

-- ---------- 月間成績の確定版（第2弾で使用） ----------
CREATE TABLE IF NOT EXISTS bb_monthly_stats (
  ym                 TEXT NOT NULL,              -- YYYY-MM
  user_id            TEXT NOT NULL REFERENCES bb_users(user_id),
  races              INTEGER NOT NULL DEFAULT 0, -- 投票レース数（未投票を含む）
  hits               INTEGER NOT NULL DEFAULT 0,
  stake              INTEGER NOT NULL DEFAULT 0,
  refund             INTEGER NOT NULL DEFAULT 0,
  payout             INTEGER NOT NULL DEFAULT 0,
  max_payout         INTEGER NOT NULL DEFAULT 0, -- 最高払戻額
  max_payout_points  INTEGER,                    -- そのときの購入点数
  max_payout_odds    REAL,                       -- そのときの的中倍率
  battles            INTEGER NOT NULL DEFAULT 0,
  wins               INTEGER NOT NULL DEFAULT 0,
  rank               INTEGER,
  visitors           INTEGER NOT NULL DEFAULT 0, -- 集客pt（その月に、自分のリンクから来場した人数）
  visitor_rank       INTEGER,                    -- 集客ptの順位
  PRIMARY KEY (ym, user_id)
);

-- ---------- 流入の記録（集客pt） ----------
-- 予想屋のリンクから、バトルルームに来場した人を記録する。1人の来場者は、1つのバトルルームにつき1回だけ数える。
-- visitor_id は端末のブラウザに持たせるランダムな番号（個人を特定しない）。
-- ip_hash は同じ接続元からの数えすぎを防ぐためのもので、ルームと日付ごとに変わる（接続元そのものは保存しない）。
CREATE TABLE IF NOT EXISTS bb_visits (
  room_id     TEXT NOT NULL,
  visitor_id  TEXT NOT NULL,
  sharer_id   TEXT NOT NULL,     -- リンクをシェアした予想屋（bb_users.user_id）
  phase       TEXT,              -- どの節目のシェアから来たか（任意）
  ip_hash     TEXT,
  day         TEXT NOT NULL,     -- YYYY-MM-DD（日本時間）
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (room_id, visitor_id)
);
CREATE INDEX IF NOT EXISTS idx_bb_visits_sharer ON bb_visits(sharer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bb_visits_ip ON bb_visits(room_id, ip_hash, day);

-- ---------- コメント ----------
-- バトルルームの中のコメント。予想屋もギャラリーも、Xでログインすれば書ける。
-- 削除したコメントは、行を残したまま hidden を 1 にする（誰が消したかを hidden_by に残す）。
CREATE TABLE IF NOT EXISTS bb_comments (
  comment_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     TEXT NOT NULL REFERENCES bb_rooms(room_id),
  user_id     TEXT NOT NULL REFERENCES bb_users(user_id),
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,
  hidden_by   TEXT
);
CREATE INDEX IF NOT EXISTS idx_bb_comments_room ON bb_comments(room_id, comment_id);
CREATE INDEX IF NOT EXISTS idx_bb_comments_user ON bb_comments(user_id, created_at);

-- ---------- ライブ中継 ----------
-- 競輪場ごとの、公式YouTubeチャンネルの対応表。管理画面で登録する。
-- channel_id は「UC」で始まる24文字のチャンネルID。source は、登録のときに入力された文字（アドレスなど）。
CREATE TABLE IF NOT EXISTS bb_venue_live (
  venue_id    TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  source      TEXT,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);

-- ---------- プレミアム（入場コード） ----------
-- 4桁の入場コード。kind は bb（BattleBank専用。noteで販売。10日ごとに切り替え）か brain（Brainの入場コード。毎月切り替え）。
-- 有効期間の中にあるコードを入力できた人を、そのコードの期限までプレミアムユーザーとして扱う。
CREATE TABLE IF NOT EXISTS bb_codes (
  code_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL CHECK (kind IN ('bb','brain')),
  code         TEXT NOT NULL,
  valid_from   INTEGER NOT NULL,
  valid_until  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  created_by   TEXT,
  note_url     TEXT                    -- このコードを販売しているnoteの記事のアドレス（入場コードの画面の「入手する」の行き先）
);
CREATE INDEX IF NOT EXISTS idx_bb_codes_valid ON bb_codes(valid_until);

-- サイトの設定（名前と値）。noteの記事のアドレス、プレミアムの印に使う鍵など
CREATE TABLE IF NOT EXISTS bb_settings (
  name   TEXT PRIMARY KEY,
  value  TEXT
);

-- コードの入力失敗の記録（総当たりを防ぐ）。接続元ごと・1時間ごとの回数
CREATE TABLE IF NOT EXISTS bb_code_fails (
  ip_key  TEXT NOT NULL,
  slot    INTEGER NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_key, slot)
);

-- ---------- 管理操作の記録 ----------
CREATE TABLE IF NOT EXISTS bb_admin_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  action  TEXT NOT NULL,
  target  TEXT,
  note    TEXT
);
