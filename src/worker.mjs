import { replay, coinsForScore } from '../public/engine.mjs';
import { replayBlocks, coinsForBlocksScore } from '../public/blocks-engine.mjs';
import { replayColors, coinsForColorsScore } from '../public/color-engine.mjs';
import { THEMES } from '../public/catalog.mjs';
import { validateTelegramInitData, mintSession, verifySession, getCookie } from './auth.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const DAY = 86400;
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
const fail = (status, message) => json({ error: message }, status);
const now = () => Math.floor(Date.now() / 1000);
const todayUTC = () => new Date().toISOString().slice(0, 10);
function originAllowed(request) { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }
function sameSiteCookie(value) { return `ms_session=${value}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=604800`; }
async function getUser(request, env) {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const verified = await verifySession(authHeader.slice(7).trim(), env.SESSION_SECRET);
    if (verified) return verified;
  }
  return verifySession(getCookie(request, 'ms_session'), env.SESSION_SECRET);
}
async function bodyJSON(request) {
  if (!String(request.headers.get('content-type') || '').startsWith('application/json')) throw new Error('JSON required');
  if (Number(request.headers.get('content-length') || 0) > 20000) throw new Error('Request too large');
  const text = await request.text();
  if (text.length > 20000) throw new Error('Request too large');
  return JSON.parse(text);
}
function safeName(player) { return String(player.firstName || 'Player').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || 'Player'; }
async function dailySeed(secret, day) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`merge-streak-daily:${day}`)));
  return new DataView(bytes.buffer).getUint32(0, false);
}
function currentStreak(days) {
  const dates = new Set(days);
  let cursor = new Date(`${todayUTC()}T00:00:00Z`);
  if (!dates.has(cursor.toISOString().slice(0,10))) cursor = new Date(cursor.getTime() - DAY*1000);
  let total = 0;
  while (dates.has(cursor.toISOString().slice(0,10)) && total < 365) {
    total++; cursor = new Date(cursor.getTime() - DAY*1000);
  }
  return total;
}
async function userProfile(env, uid) {
  const [player, themed, active, days, recent, daily] = await Promise.all([
    env.DB.prepare('SELECT id, display_name AS name, coins, best_score AS bestScore, best_tile AS bestTile, games_played AS gamesPlayed, equipped_theme AS equippedTheme, COALESCE(best_blocks_score, 0) AS bestBlocksScore, COALESCE(best_cascade_score, 0) AS bestCascadeScore FROM players WHERE id=?').bind(uid).first(),
    env.DB.prepare('SELECT theme_id AS id FROM player_themes WHERE player_id=?').bind(uid).all(),
    env.DB.prepare('SELECT id, seed, mode, COALESCE(game_type, "merge") AS gameType, challenge_day AS challengeDay, started_at AS startedAt FROM games WHERE player_id=? AND finished_at IS NULL AND started_at>? ORDER BY started_at DESC LIMIT 30').bind(uid, now()-DAY*7).all(),
    env.DB.prepare("SELECT DISTINCT date(finished_at,'unixepoch') AS day FROM games WHERE player_id=? AND finished_at IS NOT NULL ORDER BY day DESC LIMIT 40").bind(uid).all(),
    env.DB.prepare('SELECT score, mode, COALESCE(game_type, "merge") AS gameType, finished_at AS finishedAt FROM games WHERE player_id=? AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 5').bind(uid).all(),
    env.DB.prepare('SELECT id, finished_at AS finishedAt, score FROM games WHERE player_id=? AND mode=? AND challenge_day=? LIMIT 1').bind(uid, 'daily', todayUTC()).first()
  ]);
  if (!player) return null;
  return { player: { ...player, streak: currentStreak((days.results||[]).map(d=>d.day)), ownedThemes: ['mint', ...(themed.results||[]).map(x=>x.id)] }, activeRuns: active.results||[], recentGames: recent.results||[], daily: { date:todayUTC(), started: Boolean(daily), completed: Boolean(daily?.finishedAt), score:daily?.score??null } };
}
async function handleTelegramWebhook(request, env) {
  if (!env.BOT_TOKEN) return json({ ok: false, error: 'No bot token' });
  try {
    const update = await request.json();
    const message = update?.message || update?.edited_message;
    if (!message || !message.chat?.id) return json({ ok: true });
    const chatId = message.chat.id;
    const firstName = message.from?.first_name || 'Player';
    const appUrl = 'https://merge-streak-telegram-game.shahriyarkarimsiam.workers.dev';

    await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `👋 Hello *${firstName}*!\n\n🎮 Welcome to *Merge Streak Arcade*!\n\nChoose a game to play and climb the leaderboards:\n• 🔢 *Merge Streak* (4x4 2048 puzzle)\n• 🧱 *Block Collapse* (8x8 line clearing puzzle)\n• 🔮 *Color Cascade* (7x7 match-3 gem puzzle)\n\n👇 Tap below to start playing:`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔢 Play Merge Streak', web_app: { url: `${appUrl}?game=merge` } }
            ],
            [
              { text: '🧱 Play Block Collapse', web_app: { url: `${appUrl}?game=blocks` } }
            ],
            [
              { text: '🔮 Play Color Cascade', web_app: { url: `${appUrl}?game=cascade` } }
            ],
            [
              { text: '⚡ Daily Challenge', web_app: { url: `${appUrl}?mode=daily` } }
            ]
          ]
        }
      })
    });
  } catch (err) {
    console.error('Webhook error:', err);
  }
  return json({ ok: true });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (method === 'OPTIONS') return fail(405, 'Not supported');

  if (method === 'POST' && path === '/api/telegram/webhook') {
    return handleTelegramWebhook(request, env);
  }

  if (method !== 'GET' && !originAllowed(request)) return fail(403, 'Invalid request origin');
  if (method === 'GET' && path === '/api/health') return json({ ok:true, version:'0.2.0', adsEnabled:false, withdrawalsEnabled:false });

  if (method === 'POST' && path === '/api/auth/telegram') {
    if (!env.BOT_TOKEN || !env.SESSION_SECRET || !env.DB) return fail(503, 'Server is not configured');
    const input = await bodyJSON(request);
    const person = await validateTelegramInitData(input.initData, env.BOT_TOKEN);
    if (!person) return fail(401, 'Invalid or expired Telegram authentication');
    const stamp = now();
    await env.DB.prepare(`INSERT INTO players (id,display_name,username,created_at,last_seen_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,username=excluded.username,last_seen_at=excluded.last_seen_at`)
      .bind(person.id,safeName(person),person.username,stamp,stamp).run();
    await env.DB.prepare('INSERT OR IGNORE INTO player_days(player_id,day) VALUES (?,?)').bind(person.id,todayUTC()).run();
    const signed = await mintSession(person.id, env.SESSION_SECRET);
    return json({ ok:true, token: signed }, 200, { 'set-cookie':sameSiteCookie(signed) });
  }
  if (method === 'GET' && path === '/api/leaderboard') {
    if (!env.DB) return fail(503, 'Database unavailable');
    const rawGame = url.searchParams.get('game');
    const gameType = rawGame === 'blocks' ? 'blocks' : rawGame === 'cascade' ? 'cascade' : 'merge';
    const isDaily = url.searchParams.get('mode') === 'daily';
    let query;
    if (gameType === 'blocks') {
      query = isDaily
        ? env.DB.prepare(`SELECT p.display_name AS name, g.score AS score FROM games g JOIN players p ON p.id=g.player_id
             WHERE g.game_type='blocks' AND g.mode='daily' AND g.challenge_day=? AND g.finished_at IS NOT NULL ORDER BY g.score DESC, g.finished_at ASC LIMIT 20`).bind(todayUTC())
        : env.DB.prepare('SELECT display_name AS name, best_blocks_score AS score FROM players WHERE best_blocks_score>0 ORDER BY best_blocks_score DESC, created_at ASC LIMIT 20');
    } else if (gameType === 'cascade') {
      query = isDaily
        ? env.DB.prepare(`SELECT p.display_name AS name, g.score AS score FROM games g JOIN players p ON p.id=g.player_id
             WHERE g.game_type='cascade' AND g.mode='daily' AND g.challenge_day=? AND g.finished_at IS NOT NULL ORDER BY g.score DESC, g.finished_at ASC LIMIT 20`).bind(todayUTC())
        : env.DB.prepare('SELECT display_name AS name, best_cascade_score AS score FROM players WHERE best_cascade_score>0 ORDER BY best_cascade_score DESC, created_at ASC LIMIT 20');
    } else {
      query = isDaily
        ? env.DB.prepare(`SELECT p.display_name AS name, g.score AS score FROM games g JOIN players p ON p.id=g.player_id
             WHERE (g.game_type='merge' OR g.game_type IS NULL) AND g.mode='daily' AND g.challenge_day=? AND g.finished_at IS NOT NULL ORDER BY g.score DESC, g.finished_at ASC LIMIT 20`).bind(todayUTC())
        : env.DB.prepare('SELECT display_name AS name, best_score AS score FROM players WHERE best_score>0 ORDER BY best_score DESC, created_at ASC LIMIT 20');
    }
    const { results } = await query.all();
    return json({ game: gameType, mode: isDaily ? 'daily' : 'classic', day: isDaily ? todayUTC() : null, leaders: results || [] });
  }
  if (path.startsWith('/api/')) {
    const uid = await getUser(request,env);
    if (!uid) return fail(401, 'Open the app in Telegram to use online features');
    if (method==='GET' && path==='/api/me') {
      const data = await userProfile(env,uid);
      return data ? json(data) : fail(401,'Player account unavailable');
    }
    if (method==='POST' && path==='/api/game/start') {
      const input = await bodyJSON(request);
      const rawGame = input.game;
      const gameType = rawGame === 'blocks' ? 'blocks' : rawGame === 'cascade' ? 'cascade' : 'merge';
      const mode = input.mode ?? 'classic';
      if (mode!=='classic' && mode!=='daily') return fail(400,'Unknown game mode');
      const stamp=now(), day=todayUTC();
      if (mode==='daily') {
        const already = await env.DB.prepare('SELECT id,seed,started_at AS startedAt,finished_at AS finishedAt FROM games WHERE player_id=? AND game_type=? AND mode=? AND challenge_day=?').bind(uid,gameType,'daily',day).first();
        if (already?.finishedAt) return fail(409,'Daily challenge already completed; return tomorrow (UTC).');
        if (already) return json({ id:already.id,seed:already.seed,startedAt:already.startedAt,mode,game:gameType,challengeDay:day,reused:true });
      }
      const recent = await env.DB.prepare('SELECT COUNT(*) AS total FROM games WHERE player_id=? AND started_at>?').bind(uid,stamp-600).first();
      if ((recent?.total||0)>=20) return fail(429,'Too many game starts. Try again later.');
      const id=crypto.randomUUID(), random=new Uint32Array(1); crypto.getRandomValues(random);
      const seed=mode==='daily'?await dailySeed(env.SESSION_SECRET,`${gameType}:${day}`):random[0];
      try {
        await env.DB.prepare('INSERT INTO games(id,player_id,seed,started_at,mode,game_type,challenge_day) VALUES (?,?,?,?,?,?,?)').bind(id,uid,seed,stamp,mode,gameType,mode==='daily'?day:null).run();
      } catch(err) {
        if (mode==='daily') {
          const existing=await env.DB.prepare('SELECT id,seed,started_at AS startedAt,finished_at AS finishedAt FROM games WHERE player_id=? AND game_type=? AND mode=? AND challenge_day=?').bind(uid,gameType,'daily',day).first();
          if (existing && !existing.finishedAt) return json({ id:existing.id,seed:existing.seed,startedAt:existing.startedAt,mode,game:gameType,challengeDay:day,reused:true });
          if (existing) return fail(409,'Daily challenge already completed; return tomorrow (UTC).');
        }
        throw err;
      }
      return json({ id,seed,startedAt:stamp,mode,game:gameType,challengeDay:mode==='daily'?day:null },201);
    }
    if (method==='POST' && path==='/api/game/finish') {
      const input = await bodyJSON(request);
      if (typeof input.id!=='string'|| !/^[0-9a-f-]{36}$/.test(input.id)) return fail(400,'Invalid game ID');
      if (!Array.isArray(input.moves) || input.moves.length>2500) return fail(400,'Invalid moves');
      const game=await env.DB.prepare('SELECT id,seed,mode,COALESCE(game_type,"merge") AS gameType,challenge_day AS challengeDay,started_at AS startedAt,finished_at AS finishedAt FROM games WHERE id=? AND player_id=?').bind(input.id,uid).first();
      if (!game) return fail(404,'Game not found');
      if (game.finishedAt) return fail(409,'Game already saved');
      if (now()-game.startedAt>DAY*7) return fail(410,'Game expired');
      if (game.mode==='daily' && game.challengeDay!==todayUTC()) return fail(410,'Daily challenge expired at 00:00 UTC');

      let verifiedScore = 0;
      let coins = 0;
      let bestTile = 0;

      if (game.gameType === 'blocks') {
        if (input.moves.length < 1) return fail(400, 'Play at least one move');
        for (const m of input.moves) {
          if (!m || typeof m.rackIndex !== 'number' || typeof m.row !== 'number' || typeof m.col !== 'number') {
            return fail(400, 'Invalid block move');
          }
        }
        let verified;
        try { verified = replayBlocks(game.seed, input.moves); } catch { return fail(400, 'Invalid block move sequence'); }
        verifiedScore = verified.score;
        const daily = await env.DB.prepare('SELECT COALESCE(SUM(coins_awarded),0) AS total FROM games WHERE player_id=? AND finished_at>=?').bind(uid,Math.floor(now()/DAY)*DAY).first();
        coins = Math.min(coinsForBlocksScore(verifiedScore), Math.max(0, 60 - (daily?.total || 0)));
      } else if (game.gameType === 'cascade') {
        if (input.moves.length < 1) return fail(400, 'Play at least one move');
        for (const m of input.moves) {
          if (!m || typeof m.r1 !== 'number' || typeof m.c1 !== 'number' || typeof m.r2 !== 'number' || typeof m.c2 !== 'number') {
            return fail(400, 'Invalid cascade move');
          }
        }
        let verified;
        try { verified = replayColors(game.seed, input.moves); } catch { return fail(400, 'Invalid cascade move sequence'); }
        verifiedScore = verified.score;
        const daily = await env.DB.prepare('SELECT COALESCE(SUM(coins_awarded),0) AS total FROM games WHERE player_id=? AND finished_at>=?').bind(uid,Math.floor(now()/DAY)*DAY).first();
        coins = Math.min(coinsForColorsScore(verifiedScore), Math.max(0, 60 - (daily?.total || 0)));
      } else {
        if (input.moves.length < 2 || input.moves.some(x=>!['left','right','up','down'].includes(x))) return fail(400,'Invalid moves');
        let verified;
        try { verified=replay(game.seed,input.moves); } catch { return fail(400,'Invalid game move sequence'); }
        if (now()-game.startedAt<Math.max(3,Math.floor(input.moves.length/25))) return fail(400,'Game completed too quickly');
        verifiedScore = verified.score;
        bestTile = Math.max(...verified.board);
        const daily = await env.DB.prepare('SELECT COALESCE(SUM(coins_awarded),0) AS total FROM games WHERE player_id=? AND finished_at>=?').bind(uid,Math.floor(now()/DAY)*DAY).first();
        coins = Math.min(coinsForScore(verifiedScore), Math.max(0,60-(daily?.total||0)));
      }

      const completed=await env.DB.prepare(`UPDATE games SET finished_at=?,score=?,moves_count=?,coins_awarded=?,best_tile=?
        WHERE id=? AND player_id=? AND finished_at IS NULL RETURNING id`)
        .bind(now(),verifiedScore,input.moves.length,coins,bestTile,input.id,uid).first();
      if (!completed) return fail(409,'Game already saved');
      const profile=await env.DB.prepare('SELECT coins,best_score AS bestScore,best_tile AS bestTile,games_played AS gamesPlayed,COALESCE(best_blocks_score,0) AS bestBlocksScore,COALESCE(best_cascade_score,0) AS bestCascadeScore FROM players WHERE id=?').bind(uid).first();
      return json({ saved:true, score:verifiedScore, coinsAwarded:coins, mode:game.mode, game:game.gameType, ...profile });
    }
    if (method==='POST' && path==='/api/shop/buy') {
      const input=await bodyJSON(request);
      const theme=THEMES.find(x=>x.id===input.themeId);
      if (!theme || theme.cost===0) return fail(400,'Invalid purchasable theme');
      const owned=await env.DB.prepare('SELECT 1 FROM player_themes WHERE player_id=? AND theme_id=?').bind(uid,theme.id).first();
      if (owned) return fail(409,'Theme already unlocked');
      try {
        await env.DB.prepare('INSERT INTO player_themes(player_id,theme_id,unlocked_at) VALUES (?,?,?)').bind(uid,theme.id,now()).run();
      } catch(err) {
        const msg=String(err?.message||'');
        if (msg.includes('Insufficient virtual coins')) return fail(409,'Not enough virtual coins');
        if (msg.includes('UNIQUE constraint')) return fail(409,'Theme already unlocked');
        throw err;
      }
      const balance=await env.DB.prepare('SELECT coins FROM players WHERE id=?').bind(uid).first();
      return json({ purchased:theme.id, coins:balance.coins });
    }
    if (method==='POST' && path==='/api/shop/equip') {
      const input=await bodyJSON(request), theme=THEMES.find(x=>x.id===input.themeId);
      if (!theme) return fail(400,'Unknown theme');
      if (theme.cost>0) {
        const owned=await env.DB.prepare('SELECT 1 FROM player_themes WHERE player_id=? AND theme_id=?').bind(uid,theme.id).first();
        if (!owned) return fail(403,'Unlock this theme first');
      }
      await env.DB.prepare('UPDATE players SET equipped_theme=? WHERE id=?').bind(theme.id,uid).run();
      return json({ equippedTheme:theme.id });
    }
    if (method==='GET' && path==='/api/admin/metrics') {
      if (!env.ADMIN_TELEGRAM_ID || uid!==String(env.ADMIN_TELEGRAM_ID)) return fail(403,'Not authorized');
      const [players,dau,starts,finishes,recent,dailyEntries] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS count FROM players').first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM player_days WHERE day=?').bind(todayUTC()).first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM games WHERE started_at>=?').bind(now()-DAY).first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM games WHERE finished_at>=?').bind(now()-DAY).first(),
        env.DB.prepare('SELECT COALESCE(AVG(score),0) AS avgScore FROM games WHERE finished_at>=?').bind(now()-DAY).first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM games WHERE mode=? AND challenge_day=? AND finished_at IS NOT NULL').bind('daily',todayUTC()).first()
      ]);
      return json({ registeredPlayers:players.count,dailyActivePlayersUTC:dau.count,startsLast24h:starts.count,completedLast24h:finishes.count,completedDailyChallengesUTC:dailyEntries.count,averageCompletedScoreLast24h:Math.round(recent.avgScore),adRevenueUSD:null });
    }
    return fail(404,'API route not found');
  }
  return env.ASSETS.fetch(request);
}
export default { async fetch(request,env) {
  try { return await route(request,env); }
  catch(err) { console.error('Request failed:',err?.message||err); return fail(500,'Unexpected server error'); }
} };
