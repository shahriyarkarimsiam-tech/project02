import { replay, coinsForScore } from '../public/engine.mjs';
import { replayBlocks, coinsForBlocksScore } from '../public/blocks-engine.mjs';
import { replayColors, coinsForColorsScore } from '../public/color-engine.mjs';
import { replayMemory, coinsForMemoryScore } from '../public/memory-engine.mjs';
import { replayViper, coinsForViperScore } from '../public/viper-engine.mjs';
import { THEMES } from '../public/catalog.mjs';
import { validateTelegramInitData, mintSession, verifySession, getCookie } from './auth.mjs';
import {
  currentWeekId,
  weekEndTimestamp,
  calcStarValue,
  calcUserShare,
  REVENUE_SHARE_RATIO,
  DAILY_AD_CAP,
  MIN_WITHDRAWAL_USDT
} from './pool.mjs';

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
    env.DB.prepare(`SELECT id, display_name AS name, coins, best_score AS bestScore, best_tile AS bestTile,
      games_played AS gamesPlayed, equipped_theme AS equippedTheme,
      COALESCE(best_blocks_score, 0) AS bestBlocksScore,
      COALESCE(best_cascade_score, 0) AS bestCascadeScore,
      COALESCE(best_memory_score, 0) AS bestMemoryScore,
      COALESCE(best_viper_score, 0) AS bestViperScore,
      COALESCE(stars, 0) AS stars,
      COALESCE(weekly_stars, 0) AS weeklyStars,
      COALESCE(usdt_balance, 0.0) AS usdtBalance,
      COALESCE(last_ad_at, 0) AS lastAdAt,
      payout_wallet AS payoutWallet
      FROM players WHERE id=?`).bind(uid).first(),
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
        text: `👋 Hello *${firstName}*!\n\n🎮 Welcome to *Merge Streak Arcade*!\n\nChoose a game to play and climb the leaderboards:\n• 🔢 *Merge Streak* (4x4 2048 puzzle)\n• 🧱 *Block Collapse* (8x8 line clearing puzzle)\n• 🔮 *Color Cascade* (7x7 match-3 gem puzzle)\n• 🧠 *Memory Matrix* (3x3 pattern sequence memory)\n• 🐍 *Neon Viper* (16x16 classic reflex snake)\n\n⭐ *Weekly Ad Revenue Share:*\nWatch short ads to earn Stars. 50% of all ad revenue is distributed weekly in USDT!\n\n👇 Tap below to start playing:`,
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
              { text: '🧠 Play Memory Matrix', web_app: { url: `${appUrl}?game=memory` } }
            ],
            [
              { text: '🐍 Play Neon Viper', web_app: { url: `${appUrl}?game=viper` } }
            ],
            [
              { text: '⭐ Weekly Revenue Pool', web_app: { url: `${appUrl}?view=pool` } }
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

async function handleAdPostback(request, env) {
  if (!env.DB) return fail(503, 'Database unavailable');
  const url = new URL(request.url);
  let uid, network, secret;
  if (request.method === 'POST') {
    const input = await bodyJSON(request).catch(() => ({}));
    uid = input.user_id || input.subid || input.uid;
    network = input.network || 'adsgram';
    secret = input.secret;
  } else {
    uid = url.searchParams.get('user_id') || url.searchParams.get('subid') || url.searchParams.get('uid');
    network = url.searchParams.get('network') || 'monetag';
    secret = url.searchParams.get('secret');
  }
  if (!uid) return fail(400, 'Missing user_id parameter');
  if (env.POSTBACK_SECRET && secret !== env.POSTBACK_SECRET) {
    return fail(403, 'Invalid postback secret');
  }
  const player = await env.DB.prepare('SELECT id, stars, weekly_stars, last_ad_at FROM players WHERE id=?').bind(uid).first();
  if (!player) return fail(404, 'Player not found');

  const stamp = now();
  const weekId = currentWeekId();
  const impressionId = crypto.randomUUID();
  const adRevenue = 0.02;
  const communityShare = 0.01;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO ad_impressions (id, player_id, ad_network, week_id, completed_at, reward_stars) VALUES (?, ?, ?, ?, ?, 1)'
    ).bind(impressionId, uid, network, weekId, stamp),
    env.DB.prepare(
      'UPDATE players SET stars = COALESCE(stars, 0) + 1, weekly_stars = COALESCE(weekly_stars, 0) + 1, last_ad_at = ? WHERE id = ?'
    ).bind(stamp, uid),
    env.DB.prepare(`
      INSERT INTO weekly_pools (week_id, total_stars, total_revenue_usdt, community_pool_usdt, value_per_star, status)
      VALUES (?, 1, ?, ?, ?, 'active')
      ON CONFLICT(week_id) DO UPDATE SET
        total_stars = total_stars + 1,
        total_revenue_usdt = total_revenue_usdt + excluded.total_revenue_usdt,
        community_pool_usdt = community_pool_usdt + excluded.community_pool_usdt,
        value_per_star = (community_pool_usdt + excluded.community_pool_usdt) / (total_stars + 1)
    `).bind(weekId, adRevenue, communityShare, communityShare)
  ]);

  return json({ ok: true, user_id: uid, starsAwarded: 1 });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (method === 'OPTIONS') return fail(405, 'Not supported');

  if (method === 'POST' && path === '/api/telegram/webhook') {
    return handleTelegramWebhook(request, env);
  }
  if (path === '/api/ads/postback') {
    return handleAdPostback(request, env);
  }

  if (method !== 'GET' && !originAllowed(request)) return fail(403, 'Invalid request origin');
  if (method === 'GET' && path === '/api/health') return json({ ok:true, version:'0.3.0', adsEnabled:true, withdrawalsEnabled:true });

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
    const gameType = rawGame === 'blocks' ? 'blocks' : rawGame === 'cascade' ? 'cascade' : rawGame === 'memory' ? 'memory' : rawGame === 'viper' ? 'viper' : 'merge';
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
    } else if (gameType === 'memory') {
      query = isDaily
        ? env.DB.prepare(`SELECT p.display_name AS name, g.score AS score FROM games g JOIN players p ON p.id=g.player_id
             WHERE g.game_type='memory' AND g.mode='daily' AND g.challenge_day=? AND g.finished_at IS NOT NULL ORDER BY g.score DESC, g.finished_at ASC LIMIT 20`).bind(todayUTC())
        : env.DB.prepare('SELECT display_name AS name, best_memory_score AS score FROM players WHERE best_memory_score>0 ORDER BY best_memory_score DESC, created_at ASC LIMIT 20');
    } else if (gameType === 'viper') {
      query = isDaily
        ? env.DB.prepare(`SELECT p.display_name AS name, g.score AS score FROM games g JOIN players p ON p.id=g.player_id
             WHERE g.game_type='viper' AND g.mode='daily' AND g.challenge_day=? AND g.finished_at IS NOT NULL ORDER BY g.score DESC, g.finished_at ASC LIMIT 20`).bind(todayUTC())
        : env.DB.prepare('SELECT display_name AS name, best_viper_score AS score FROM players WHERE best_viper_score>0 ORDER BY best_viper_score DESC, created_at ASC LIMIT 20');
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

    if (method === 'GET' && path === '/api/ads/pool') {
      if (!env.DB) return fail(503, 'Database unavailable');
      const weekId = currentWeekId();
      const endsAt = weekEndTimestamp();
      const [player, pool, ads24h] = await Promise.all([
        env.DB.prepare('SELECT stars, weekly_stars, usdt_balance, last_ad_at, payout_wallet FROM players WHERE id=?').bind(uid).first(),
        env.DB.prepare('SELECT total_stars, total_revenue_usdt, community_pool_usdt, value_per_star, status FROM weekly_pools WHERE week_id=?').bind(weekId).first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM ad_impressions WHERE player_id=? AND completed_at>=?').bind(uid, now() - DAY).first()
      ]);

      const communityTotalStars = pool?.total_stars || 0;
      const communityPoolUsdt = pool?.community_pool_usdt || 0.0;
      const valuePerStar = calcStarValue(communityPoolUsdt, communityTotalStars);
      const userWeeklyStars = player?.weekly_stars || 0;
      const userTotalStars = player?.stars || 0;
      const userEstimatedShareUsdt = calcUserShare(userWeeklyStars, valuePerStar);
      const userUsdtBalance = player?.usdt_balance || 0.0;
      const adsWatchedToday = ads24h?.count || 0;
      const cooldownRemaining = Math.max(0, 60 - (now() - (player?.last_ad_at || 0)));

      return json({
        weekId,
        endsAt,
        communityTotalStars,
        communityPoolUsdt,
        estimatedValuePerStar: valuePerStar,
        userWeeklyStars,
        userTotalStars,
        userEstimatedShareUsdt,
        userUsdtBalance,
        adsWatchedToday,
        dailyCap: DAILY_AD_CAP,
        cooldownSecondsRemaining: cooldownRemaining,
        minWithdrawalUsdt: MIN_WITHDRAWAL_USDT,
        payoutWallet: player?.payout_wallet || null
      });
    }

    if (method === 'POST' && path === '/api/ads/claim') {
      if (!env.DB) return fail(503, 'Database unavailable');
      const player = await env.DB.prepare('SELECT stars, weekly_stars, usdt_balance, last_ad_at FROM players WHERE id=?').bind(uid).first();
      if (!player) return fail(404, 'Player not found');

      const stamp = now();
      const lastAd = player.last_ad_at || 0;
      if (lastAd && stamp - lastAd < 55) {
        const remaining = Math.max(1, 60 - (stamp - lastAd));
        return fail(429, `Ad cooldown active. Please wait ${remaining}s before watching another ad.`);
      }

      const dailyAds = await env.DB.prepare('SELECT COUNT(*) AS count FROM ad_impressions WHERE player_id=? AND completed_at>=?').bind(uid, stamp - DAY).first();
      const adsToday = dailyAds?.count || 0;
      if (adsToday >= DAILY_AD_CAP) {
        return fail(429, 'Daily ad limit reached (20 ads / 24 hours). Come back tomorrow!');
      }

      const input = await bodyJSON(request).catch(() => ({}));
      const adNetwork = ['direct', 'adsgram', 'monetag'].includes(input.network) ? input.network : 'direct';
      const weekId = currentWeekId();
      const impressionId = crypto.randomUUID();
      const adRevenue = 0.02;
      const communityShare = 0.01;

      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO ad_impressions (id, player_id, ad_network, week_id, completed_at, reward_stars) VALUES (?, ?, ?, ?, ?, 1)'
        ).bind(impressionId, uid, adNetwork, weekId, stamp),
        env.DB.prepare(
          'UPDATE players SET stars = COALESCE(stars, 0) + 1, weekly_stars = COALESCE(weekly_stars, 0) + 1, last_ad_at = ? WHERE id = ?'
        ).bind(stamp, uid),
        env.DB.prepare(`
          INSERT INTO weekly_pools (week_id, total_stars, total_revenue_usdt, community_pool_usdt, value_per_star, status)
          VALUES (?, 1, ?, ?, ?, 'active')
          ON CONFLICT(week_id) DO UPDATE SET
            total_stars = total_stars + 1,
            total_revenue_usdt = total_revenue_usdt + excluded.total_revenue_usdt,
            community_pool_usdt = community_pool_usdt + excluded.community_pool_usdt,
            value_per_star = (community_pool_usdt + excluded.community_pool_usdt) / (total_stars + 1)
        `).bind(weekId, adRevenue, communityShare, communityShare)
      ]);

      const updated = await env.DB.prepare('SELECT stars, weekly_stars, usdt_balance FROM players WHERE id=?').bind(uid).first();
      return json({
        ok: true,
        rewardStars: 1,
        stars: updated.stars,
        weeklyStars: updated.weekly_stars,
        adsToday: adsToday + 1,
        dailyCap: DAILY_AD_CAP,
        cooldownSeconds: 60
      });
    }

    if (method === 'POST' && path === '/api/wallet/withdraw') {
      if (!env.DB) return fail(503, 'Database unavailable');
      const input = await bodyJSON(request);
      const amount = Number(input.amount);
      const network = String(input.network || '').toUpperCase();
      const address = String(input.address || '').trim();

      if (!['TON', 'TRC20'].includes(network)) {
        return fail(400, 'Invalid network. Supported payout networks: TON, TRC20');
      }
      if (!address || address.length < 10 || address.length > 100) {
        return fail(400, 'Please enter a valid wallet address (10-100 characters)');
      }
      if (isNaN(amount) || amount < MIN_WITHDRAWAL_USDT) {
        return fail(400, `Minimum withdrawal amount is $${MIN_WITHDRAWAL_USDT.toFixed(2)} USDT`);
      }

      const player = await env.DB.prepare('SELECT usdt_balance FROM players WHERE id=?').bind(uid).first();
      if (!player || (player.usdt_balance || 0) < amount) {
        return fail(400, 'Insufficient USDT balance');
      }

      const reqId = crypto.randomUUID();
      const stamp = now();

      await env.DB.batch([
        env.DB.prepare(
          'UPDATE players SET usdt_balance = usdt_balance - ?, payout_wallet = ? WHERE id = ?'
        ).bind(amount, address, uid),
        env.DB.prepare(
          'INSERT INTO withdrawal_requests (id, player_id, amount_usdt, network, wallet_address, status, requested_at) VALUES (?, ?, ?, ?, ?, "pending", ?)'
        ).bind(reqId, uid, amount, network, address, stamp)
      ]);

      const updated = await env.DB.prepare('SELECT usdt_balance FROM players WHERE id=?').bind(uid).first();
      return json({
        ok: true,
        requestId: reqId,
        amount,
        network,
        address,
        remainingBalance: updated.usdt_balance,
        status: 'pending'
      });
    }

    if (method === 'POST' && path === '/api/admin/settle-week') {
      if (!env.DB) return fail(503, 'Database unavailable');
      const isIdAdmin = env.ADMIN_TELEGRAM_ID && uid === String(env.ADMIN_TELEGRAM_ID);
      const isKeyAdmin = env.ADMIN_SECRET && request.headers.get('x-admin-key') === env.ADMIN_SECRET;
      if (!isIdAdmin && !isKeyAdmin) return fail(403, 'Not authorized');

      const input = await bodyJSON(request);
      const targetWeekId = input.weekId || currentWeekId();
      const totalRevenue = Number(input.adRevenueUsdt);
      if (isNaN(totalRevenue) || totalRevenue < 0) {
        return fail(400, 'Invalid adRevenueUsdt amount');
      }

      const communityPool = totalRevenue * REVENUE_SHARE_RATIO;
      const poolRow = await env.DB.prepare('SELECT total_stars FROM weekly_pools WHERE week_id=?').bind(targetWeekId).first();
      const totalStars = poolRow?.total_stars || 0;
      const valuePerStar = calcStarValue(communityPool, totalStars);
      const stamp = now();

      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO weekly_pools (week_id, total_revenue_usdt, community_pool_usdt, total_stars, value_per_star, status, settled_at)
          VALUES (?, ?, ?, ?, ?, 'settled', ?)
          ON CONFLICT(week_id) DO UPDATE SET
            total_revenue_usdt = excluded.total_revenue_usdt,
            community_pool_usdt = excluded.community_pool_usdt,
            value_per_star = excluded.value_per_star,
            status = 'settled',
            settled_at = excluded.settled_at
        `).bind(targetWeekId, totalRevenue, communityPool, totalStars, valuePerStar, stamp),
        env.DB.prepare(`
          UPDATE players
          SET usdt_balance = COALESCE(usdt_balance, 0.0) + (COALESCE(weekly_stars, 0) * ?),
              weekly_stars = 0
          WHERE weekly_stars > 0
        `).bind(valuePerStar)
      ]);

      return json({
        ok: true,
        weekId: targetWeekId,
        totalRevenueUsdt: totalRevenue,
        communityPoolUsdt: communityPool,
        totalStars,
        valuePerStar,
        settledAt: stamp
      });
    }

    if (method==='POST' && path==='/api/game/start') {
      const input = await bodyJSON(request);
      const rawGame = input.game;
      const gameType = rawGame === 'blocks' ? 'blocks' : rawGame === 'cascade' ? 'cascade' : rawGame === 'memory' ? 'memory' : rawGame === 'viper' ? 'viper' : 'merge';
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
      } else if (game.gameType === 'memory') {
        if (input.moves.length < 1) return fail(400, 'Play at least one move');
        for (const m of input.moves) {
          if (!m || typeof m.pad !== 'number' || m.pad < 0 || m.pad > 8) {
            return fail(400, 'Invalid memory move');
          }
        }
        let verified;
        try { verified = replayMemory(game.seed, input.moves); } catch { return fail(400, 'Invalid memory move sequence'); }
        verifiedScore = verified.score;
        const daily = await env.DB.prepare('SELECT COALESCE(SUM(coins_awarded),0) AS total FROM games WHERE player_id=? AND finished_at>=?').bind(uid,Math.floor(now()/DAY)*DAY).first();
        coins = Math.min(coinsForMemoryScore(verifiedScore), Math.max(0, 60 - (daily?.total || 0)));
      } else if (game.gameType === 'viper') {
        if (input.moves.length < 1) return fail(400, 'Play at least one move');
        for (const m of input.moves) {
          const dir = typeof m === 'string' ? m : m?.dir;
          if (!['up','down','left','right'].includes(dir)) {
            return fail(400, 'Invalid viper move');
          }
        }
        let verified;
        try { verified = replayViper(game.seed, input.moves); } catch { return fail(400, 'Invalid viper move sequence'); }
        verifiedScore = verified.score;
        const daily = await env.DB.prepare('SELECT COALESCE(SUM(coins_awarded),0) AS total FROM games WHERE player_id=? AND finished_at>=?').bind(uid,Math.floor(now()/DAY)*DAY).first();
        coins = Math.min(coinsForViperScore(verifiedScore), Math.max(0, 60 - (daily?.total || 0)));
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
      const profile=await env.DB.prepare('SELECT coins,best_score AS bestScore,best_tile AS bestTile,games_played AS gamesPlayed,COALESCE(best_blocks_score,0) AS bestBlocksScore,COALESCE(best_cascade_score,0) AS bestCascadeScore,COALESCE(best_memory_score,0) AS bestMemoryScore,COALESCE(best_viper_score,0) AS bestViperScore,COALESCE(stars,0) AS stars,COALESCE(weekly_stars,0) AS weeklyStars,COALESCE(usdt_balance,0.0) AS usdtBalance FROM players WHERE id=?').bind(uid).first();
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
