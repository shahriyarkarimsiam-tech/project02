import { newGame, move, replay, coinsForScore } from './engine.mjs';
import { newBlocksGame, canPlace, placeBlock, replayBlocks, coinsForBlocksScore, GRID_SIZE } from './blocks-engine.mjs';
import { newColorGame, swapGems, replayColors, coinsForColorsScore, GEMS, BOARD_SIZE, MAX_MOVES } from './color-engine.mjs';
import { newMemoryGame, tapPad, replayMemory, coinsForMemoryScore, PADS, NUM_PADS, MAX_LIVES } from './memory-engine.mjs';
import { newViperGame, stepSnake, replayViper, coinsForViperScore, GRID_SIZE as VIPER_GRID_SIZE } from './viper-engine.mjs';
import { THEMES, earnedBadges } from './catalog.mjs';

const $ = id => document.getElementById(id);
const tg = window.Telegram?.WebApp;
const dateUTC = () => new Date().toISOString().slice(0, 10);
const stamp = () => Math.floor(Date.now() / 1000);
const num = n => Number(n || 0).toLocaleString('en-US');
const names = { home: 'Overview', play: 'Play game', pool: 'Weekly Pool', challenges: 'Challenges', rankings: 'Rankings', shop: 'Theme shop', profile: 'My profile' };
const ranks = [{ at: 0, title: 'Rookie explorer' }, { at: 1, title: 'Bronze merger' }, { at: 5, title: 'Silver strategist' }, { at: 15, title: 'Golden master' }, { at: 40, title: 'Diamond legend' }];
const emptyPlayer = () => ({ id: 'demo', name: 'Guest player', coins: 0, bestScore: 0, bestTile: 0, bestBlocksScore: 0, bestCascadeScore: 0, bestMemoryScore: 0, bestViperScore: 0, gamesPlayed: 0, streak: 0, equippedTheme: 'mint', ownedThemes: ['mint'], stars: 0, weeklyStars: 0, usdtBalance: 0.0, lastAdAt: 0, payoutWallet: '', referralsCount: 0, referralsRequired: 10, hasWithdrawn: false, canWithdraw: false, referralLink: 'https://t.me/mergestakeearn_bot?start=ref_demo' });

let player = emptyPlayer(), online = false, view = 'home';
let activeGame = 'merge'; // 'merge' | 'blocks' | 'cascade' | 'memory' | 'viper'
let rankGame = 'merge';   // 'merge' | 'blocks' | 'cascade' | 'memory' | 'viper'
let rankMode = 'classic'; // 'classic' | 'daily'
let currentMode = 'classic'; // for Merge Streak
let lastFinishedGameType = 'merge';

// Merge Streak state
let state = null, moves = [], currentRun = null, completed = false, busy = false, toastTimer;
let activeRuns = [], recentGames = [], daily = { date: dateUTC(), started: false, completed: false, score: null };
const leaderCache = {};

// Block Collapse state
let blocksState = null, blocksMoves = [], currentBlocksRun = null, blocksCompleted = false, blocksBusy = false, selectedRackIndex = -1;

// Color Cascade state
let cascadeState = null, cascadeMoves = [], currentCascadeRun = null, cascadeCompleted = false, cascadeBusy = false, selectedGemCoord = null;

// Memory Matrix state
let memoryState = null, memoryMoves = [], currentMemoryRun = null, memoryCompleted = false, memoryBusy = false, isPlayingSequence = false;

// Neon Viper state
let viperState = null, viperMoves = [], currentViperRun = null, viperCompleted = false, viperBusy = false, viperLoopTimer = null, viperNextDir = 'right';

let authToken = null;
try { authToken = sessionStorage.getItem('ms_auth_token'); } catch {}

function read(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
function erase(key) { try { localStorage.removeItem(key); } catch {} }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3300); }

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  if (authToken) headers['authorization'] = `Bearer ${authToken}`;
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    credentials: 'include',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let result = {}; try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function clear(node) { node.replaceChildren(); }
function el(tag, className = '', text = '') { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined && text !== null) item.textContent = String(text); return item; }
function seededGuestDaily(day) { let h = 2166136261; for (const c of `merge-streak-guest-${day}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function localStreak() { const days = new Set(recentGames.map(g => new Date(g.finishedAt * 1000).toISOString().slice(0, 10))); let day = new Date(`${dateUTC()}T00:00:00Z`); if (!days.has(dateUTC())) day = new Date(day.getTime() - 86400000); let count = 0; while (days.has(day.toISOString().slice(0, 10))) { count++; day = new Date(day.getTime() - 86400000); if (count >= 365) break; } return count; }
function refreshGuestDaily() { const day = dateUTC(); if (daily.date !== day) { daily = { date: day, started: false, completed: false, score: null }; write('ms_demo_daily', daily); } }

function draftKey(run) { return online ? `ms_run_${player.id}_${run.id}` : `ms_demo_run_${run.mode}`; }
function saveDraft() { if (!currentRun || completed) return; write(draftKey(currentRun), { seed: currentRun.seed, moves, mode: currentRun.mode, challengeDay: currentRun.challengeDay, id: currentRun.id }); }

function draftKeyBlocks(run) { return online ? `ms_blocks_run_${player.id}_${run.id}` : 'ms_demo_blocks_run'; }
function saveBlocksDraft() { if (!currentBlocksRun || blocksCompleted) return; write(draftKeyBlocks(currentBlocksRun), { seed: currentBlocksRun.seed, moves: blocksMoves, mode: currentBlocksRun.mode, id: currentBlocksRun.id }); }

function draftKeyCascade(run) { return online ? `ms_cascade_run_${player.id}_${run.id}` : 'ms_demo_cascade_run'; }
function saveCascadeDraft() { if (!currentCascadeRun || cascadeCompleted) return; write(draftKeyCascade(currentCascadeRun), { seed: currentCascadeRun.seed, moves: cascadeMoves, mode: currentCascadeRun.mode, id: currentCascadeRun.id }); }

function draftKeyMemory(run) { return online ? `ms_memory_run_${player.id}_${run.id}` : 'ms_demo_memory_run'; }
function saveMemoryDraft() { if (!currentMemoryRun || memoryCompleted) return; write(draftKeyMemory(currentMemoryRun), { seed: currentMemoryRun.seed, moves: memoryMoves, mode: currentMemoryRun.mode, id: currentMemoryRun.id }); }

function draftKeyViper(run) { return online ? `ms_viper_run_${player.id}_${run.id}` : 'ms_demo_viper_run'; }
function saveViperDraft() { if (!currentViperRun || viperCompleted) return; write(draftKeyViper(currentViperRun), { seed: currentViperRun.seed, moves: viperMoves, mode: currentViperRun.mode, id: currentViperRun.id }); }

function storeGuest() {
  if (online) return;
  player.streak = localStreak();
  write('ms_demo_player_v2', player);
  write('ms_demo_recent', recentGames);
  write('ms_demo_daily', daily);
}

function avatar() { return (player.name || 'G').trim().charAt(0).toUpperCase() || 'G'; }

function setView(next) {
  if (!names[next]) return;
  view = next;
  if (next !== 'play') stopViperLoop();
  else if (activeGame === 'viper') startViperLoop();
  document.querySelectorAll('[data-view]').forEach(node => node.classList.toggle('active', node.dataset.view === next));
  document.querySelectorAll('[data-view-target]').forEach(node => {
    node.classList.toggle('active', node.dataset.viewTarget === next);
    if (node.classList.contains('nav-button')) node.setAttribute('aria-current', node.dataset.viewTarget === next ? 'page' : 'false');
  });
  $('page-crumb').textContent = names[next];
  if (next === 'pool') refreshPoolData();
  if (next === 'rankings') refreshLeaderboard();
  if (next === 'shop') renderShop();
  if (next === 'challenges') renderBadges();
  if (next === 'profile') renderProfilePage();
  window.scrollTo?.({ top: 0, behavior: 'instant' });
}

function updateRank() {
  const n = Number(player.gamesPlayed || 0); let current = ranks[0], next = null;
  for (let i = 0; i < ranks.length; i++) if (n >= ranks[i].at) { current = ranks[i]; next = ranks[i + 1] || null; }
  $('rank-title').textContent = current.title;
  $('rank-progress').textContent = next ? `${num(n)} / ${num(next.at)} games` : 'MAX RANK';
  const percent = next ? Math.min(100, (n - current.at) / (next.at - current.at) * 100) : 100;
  $('progress-fill').style.width = `${percent}%`;
}

function updateDailyUI() {
  if (!online) refreshGuestDaily();
  $('daily-home-tag').textContent = daily.completed ? 'COMPLETED' : daily.started ? 'IN PROGRESS' : 'NOT STARTED';
  $('daily-home-btn').textContent = daily.completed ? 'View today’s scores ↗' : daily.started ? 'Continue challenge ↗' : 'Play daily puzzle ↗';
  $('challenge-go').textContent = daily.completed ? 'See daily leaderboard ↗' : daily.started ? 'Resume daily run ↗' : 'Start daily challenge ↗';
  $('challenge-day-caption').textContent = daily.completed ? `Today's attempt saved with ${num(daily.score)} points. The next challenge opens at 00:00 UTC.` : 'Play today’s seeded challenge. One completed entry per day; your score is compared with Telegram players.';
  $('daily-day-label').textContent = `${daily.date} · Reset at 00:00 UTC`;
}

function renderProfileBase() {
  $('coin-count').textContent = num(player.coins);
  $('shop-balance').textContent = num(player.coins);
  if ($('top-stars')) $('top-stars').textContent = num(player.stars || 0);
  if ($('top-usdt')) $('top-usdt').textContent = `$${Number(player.usdtBalance || 0).toFixed(2)}`;
  $('profile-avatar').textContent = avatar();
  $('player-avatar').textContent = avatar();
  $('profile-big-avatar').textContent = avatar();
  $('player-name').textContent = player.name;
  $('profile-display-name').textContent = player.name;
  $('welcome-name').textContent = player.name.split(' ')[0] || 'player';
  $('connection-status').textContent = online ? 'Verified Telegram player' : 'Local practice mode';
  $('profile-login-status').textContent = online ? 'Your scores and unlocked themes are stored in the game database.' : 'Practice progress stays on this device; it does not appear in online rankings.';
  $('mode-label').textContent = online ? 'TELEGRAM CONNECTED' : 'PRACTICE MODE';

  $('home-best').textContent = num(Math.max(player.bestScore, state?.score || 0));
  $('home-blocks-best').textContent = num(Math.max(player.bestBlocksScore || 0, blocksState?.score || 0));
  $('home-cascade-best').textContent = num(Math.max(player.bestCascadeScore || 0, cascadeState?.score || 0));
  $('home-memory-best').textContent = num(Math.max(player.bestMemoryScore || 0, memoryState?.score || 0));
  $('home-viper-best').textContent = num(Math.max(player.bestViperScore || 0, viperState?.score || 0));
  $('home-streak').textContent = num(player.streak);

  $('best-score').textContent = num(Math.max(player.bestScore, state?.score || 0));
  $('blocks-best').textContent = num(Math.max(player.bestBlocksScore || 0, blocksState?.score || 0));
  $('cascade-best').textContent = num(Math.max(player.bestCascadeScore || 0, cascadeState?.score || 0));
  $('memory-best').textContent = num(Math.max(player.bestMemoryScore || 0, memoryState?.score || 0));
  $('viper-best').textContent = num(Math.max(player.bestViperScore || 0, viperState?.score || 0));

  $('profile-best').textContent = num(player.bestScore);
  $('profile-blocks-best').textContent = num(player.bestBlocksScore || 0);
  $('profile-cascade-best').textContent = num(player.bestCascadeScore || 0);
  $('profile-memory-best').textContent = num(player.bestMemoryScore || 0);
  $('profile-viper-best').textContent = num(player.bestViperScore || 0);
  $('profile-streak').textContent = num(player.streak);
  if ($('profile-total-stars')) $('profile-total-stars').textContent = num(player.stars || 0);
  if ($('profile-total-earned')) $('profile-total-earned').textContent = `$${Number(player.usdtBalance || 0).toFixed(2)}`;
  if ($('wallet-usdt-balance')) $('wallet-usdt-balance').textContent = `$${Number(player.usdtBalance || 0).toFixed(2)}`;
  if ($('quick-all-val')) $('quick-all-val').textContent = Number(player.usdtBalance || 0).toFixed(2);
  if ($('wallet-address-input') && !$('wallet-address-input').value && (poolData.payoutWallet || player.payoutWallet)) {
    $('wallet-address-input').value = poolData.payoutWallet || player.payoutWallet;
  }

  const refCount = Number(player.referralsCount || 0);
  const hasWithdrawn = Boolean(player.hasWithdrawn);
  const canWithdraw = hasWithdrawn || refCount >= 10;
  const refRequired = 10;
  const refPercent = Math.min(100, Math.round((refCount / refRequired) * 100));
  const botLink = player.referralLink || (player.id && player.id !== 'demo' ? `https://t.me/mergestakeearn_bot?start=ref_${player.id}` : 'https://t.me/mergestakeearn_bot');

  if ($('profile-ref-count')) $('profile-ref-count').textContent = refCount;
  if ($('profile-ref-progress-bar')) $('profile-ref-progress-bar').style.width = `${refPercent}%`;
  if ($('profile-ref-progress-text')) {
    $('profile-ref-progress-text').textContent = canWithdraw
      ? (hasWithdrawn ? '✅ Lifetime Unlocked (1st withdrawal verified)' : `🎉 Unlocked (${refCount}/10 referrals reached!)`)
      : `${refCount} / 10 Friends Invited (${Math.max(0, 10 - refCount)} more needed)`;
  }
  if ($('profile-ref-chip')) {
    $('profile-ref-chip').textContent = canWithdraw ? 'WITHDRAWAL UNLOCKED' : `LOCKED (${refCount}/10)`;
    $('profile-ref-chip').className = `soft-chip ${canWithdraw ? 'live' : 'locked'}`;
  }
  if ($('profile-ref-link-input')) $('profile-ref-link-input').value = botLink;

  const withdrawBtn = $('wallet-withdraw-btn');
  if (withdrawBtn) {
    if (!canWithdraw) {
      withdrawBtn.disabled = true;
      withdrawBtn.textContent = `🔒 10 Referrals Required (Currently ${refCount}/10)`;
    } else {
      withdrawBtn.disabled = false;
      withdrawBtn.textContent = 'Request USDT Withdrawal ↗';
    }
  }

  if ($('profile-ref-lock-notice')) {
    $('profile-ref-lock-notice').hidden = canWithdraw;
    $('profile-ref-lock-notice').textContent = `⚠️ Your 1st withdrawal is locked until you have at least 10 users joined under your link (Current: ${refCount}/10). Once completed, you never need referrals again!`;
  }

  updateRank();
  updateDailyUI();
}

function renderRecent(containerId) {
  const target = $(containerId); clear(target);
  if (!recentGames.length) { target.appendChild(el('div', 'empty-state', 'No saved games yet. Play and finish your first run!')); return; }
  for (const game of recentGames.slice(0, 5)) {
    const isBlocks = game.gameType === 'blocks';
    const isCascade = game.gameType === 'cascade';
    const isMemory = game.gameType === 'memory';
    const isViper = game.gameType === 'viper';
    const isDaily = game.mode === 'daily';
    const row = el('div', 'recent-item');
    const icon = el('span', 'recent-icon', isViper ? '🐍' : isMemory ? '🧠' : isCascade ? '🔮' : isBlocks ? '🧱' : isDaily ? '⚡' : '🔢');
    const detail = el('div');
    const label = el('strong', '', isViper ? 'Neon Viper' : isMemory ? 'Memory Matrix' : isCascade ? 'Color Cascade' : isBlocks ? 'Block Collapse' : isDaily ? 'Daily challenge' : 'Merge Streak');
    const dt = new Date(game.finishedAt * 1000).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
    detail.append(label, el('small', '', `${dt} · Completed`));
    row.append(icon, detail, el('b', '', num(game.score)));
    target.append(row);
  }
}

function renderBadges() {
  const badges = earnedBadges(player), target = $('badges-list'); clear(target);
  $('badge-count').textContent = `${badges.filter(b => b.unlocked).length} / ${badges.length} unlocked`;
  for (const badge of badges) {
    const card = el('div', `badge-card ${badge.unlocked ? 'unlocked' : 'locked'}`);
    card.append(el('div', 'badge-graphic', badge.mark), el('strong', '', badge.title), el('p', '', badge.desc), el('span', 'badge-state', badge.unlocked ? '✓ UNLOCKED' : 'LOCKED'));
    target.append(card);
  }
}

function renderProfilePage() {
  renderProfileBase();
  renderRecent('profile-recent');
  clear($('profile-badges'));
  const achieved = earnedBadges(player).filter(b => b.unlocked);
  if (!achieved.length) $('profile-badges').append(el('p', 'muted-paragraph', 'Your first badge unlocks after saving a run.'));
  for (const badge of achieved) $('profile-badges').append(el('span', '', `${badge.mark} ${badge.title}`));
  refreshUserWithdrawals();
}

function renderDashboard() {
  renderProfileBase();
  renderRecent('home-recent');
  renderBadges();
  renderProfilePage();
}

function applyTheme(id) {
  const safe = THEMES.some(t => t.id === id) ? id : 'mint';
  document.body.dataset.theme = safe;
  player.equippedTheme = safe;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', safe === 'sunset' ? '#130e1a' : '#090e1a');
}

function renderShop() {
  const target = $('theme-list'); clear(target);
  for (const theme of THEMES) {
    const owned = theme.cost === 0 || player.ownedThemes.includes(theme.id);
    const equipped = player.equippedTheme === theme.id;
    const card = el('article', 'theme-card'), preview = el('div', `theme-preview ${theme.id}`), body = el('div', 'theme-card-body'), heading = el('h3', '', theme.name), description = el('p', '', theme.note), foot = el('div', 'theme-card-footer');
    for (const n of [2, 8, 32]) preview.append(el('span', '', n));
    const price = el('span', `theme-price ${theme.cost === 0 ? 'free' : ''}`, theme.cost === 0 ? 'FREE' : `✦ ${theme.cost}`);
    const button = el('button', `btn ${equipped ? 'btn-disabled' : owned ? 'btn-primary' : 'btn-outline'}`, equipped ? '✓ Equipped' : owned ? 'Use theme' : 'Unlock theme');
    button.disabled = equipped;
    button.addEventListener('click', () => owned ? equipTheme(theme.id) : buyTheme(theme.id));
    foot.append(price, button); body.append(heading, description, foot); card.append(preview, body); target.append(card);
  }
}

async function buyTheme(id) {
  const theme = THEMES.find(x => x.id === id); if (!theme || theme.cost === 0) return;
  if (player.coins < theme.cost) { toast(`You need ${num(theme.cost - player.coins)} more virtual coins.`); return; }
  if (busy) return;
  if (!confirm(`Unlock ${theme.name} for ${theme.cost} virtual coins?`)) return;
  busy = true;
  try {
    if (online) { const result = await api('/shop/buy', { method: 'POST', body: { themeId: id } }); player.coins = result.coins; }
    else player.coins -= theme.cost;
    player.ownedThemes.push(id); storeGuest(); renderDashboard(); renderShop(); toast(`${theme.name} unlocked. You can equip it now.`);
  } catch (err) { toast(err.message); } finally { busy = false; }
}

async function equipTheme(id) {
  if (!player.ownedThemes.includes(id)) return;
  if (busy) return; busy = true;
  try {
    if (online) await api('/shop/equip', { method: 'POST', body: { themeId: id } });
    applyTheme(id); storeGuest(); renderShop(); toast('Theme equipped!');
  } catch (err) { toast(err.message); } finally { busy = false; }
}

// ==========================================
// GAME 1: MERGE STREAK (4x4)
// ==========================================

function renderBoard() {
  if (!state) return;
  const board = $('game-board'), nodes = document.createDocumentFragment();
  state.board.forEach((value, index) => {
    const node = el('div', `tile${value > 2048 ? ' high' : ''}`, value ? String(value) : '');
    node.dataset.value = String(value);
    node.setAttribute('role', 'gridcell');
    node.setAttribute('aria-label', `Row ${Math.floor(index / 4) + 1}, col ${index % 4 + 1}: ${value || 'empty'}`);
    nodes.append(node);
  });
  board.replaceChildren(nodes);
  $('score').textContent = num(state.score);
  $('move-count').textContent = num(state.moves);
  $('largest-tile').textContent = `TOP TILE · ${num(Math.max(...state.board))}`;
  $('bank-btn').disabled = busy || completed || moves.length < 2;
  $('new-game-btn').disabled = busy || currentMode === 'daily';
  $('run-mode-heading').textContent = currentMode === 'daily' ? `DAILY CHALLENGE · ${daily.date}` : 'CLASSIC MODE';
  $('run-title').textContent = currentMode === 'daily' ? 'One chance today' : 'Your next high score';
  $('game-state-chip').textContent = completed ? 'SCORE SAVED' : state.over ? 'BOARD FULL' : currentMode === 'daily' ? 'DAILY IN PROGRESS' : 'KEEP MERGING';
  document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === currentMode));
  renderProfileBase();
}

function setStatus(message) { $('game-status').textContent = message; }
function localSeed() { const arr = new Uint32Array(1); crypto.getRandomValues(arr); return arr[0]; }

function hydrateRun(run, history) {
  currentMode = run.mode || 'classic';
  currentRun = { ...run, mode: currentMode, game: 'merge' };
  moves = Array.isArray(history) ? history : [];
  try { state = replay(run.seed, moves); } catch { moves = []; state = newGame(run.seed); }
  completed = false; saveDraft(); renderBoard();
  setStatus(currentMode === 'daily' ? 'Daily challenge: this is your only scored attempt today.' : 'Swipe the tiles to combine matching numbers.');
}

async function launch(mode = 'classic', newRun = false) {
  if (busy) return;
  if (mode === 'daily' && daily.date !== dateUTC()) {
    if (online) { try { const updated = await api('/me'); daily = updated.daily; activeRuns = updated.activeRuns || []; } catch { toast('Could not refresh daily challenge.'); return; } }
    else refreshGuestDaily();
  }
  if (mode === 'daily' && daily.completed) {
    rankMode = 'daily'; rankGame = 'merge'; setView('rankings');
    document.querySelectorAll('[data-rank-mode]').forEach(b => b.classList.toggle('active', b.dataset.rankMode === 'daily'));
    refreshLeaderboard(); return;
  }
  if (!newRun && currentRun && !completed && currentMode === mode && (mode !== 'daily' || currentRun.challengeDay === dateUTC())) {
    switchGame('merge'); setView('play'); return;
  }
  if (newRun && mode === 'daily') { toast('Daily mode allows only one entry per UTC day.'); return; }
  if (!newRun && !online) {
    const draft = read(`ms_demo_run_${mode}`);
    if (draft && Number.isInteger(draft.seed) && (mode !== 'daily' || draft.challengeDay === dateUTC())) {
      hydrateRun(draft, draft.moves); switchGame('merge'); setView('play'); return;
    }
  }
  if (!newRun && online) {
    const active = activeRuns.find(r => r.mode === mode && (r.gameType === 'merge' || !r.gameType) && (mode === 'classic' || r.challengeDay === dateUTC()));
    if (active) { const saved = read(`ms_run_${player.id}_${active.id}`, {}); hydrateRun(active, saved.moves || []); switchGame('merge'); setView('play'); return; }
  }
  if (newRun && currentRun && !completed && currentMode === mode && moves.length > 0 && !confirm('Start a new run? Your unfinished score will be abandoned.')) return;
  busy = true;
  try {
    let run;
    if (online) { run = await api('/game/start', { method: 'POST', body: { game: 'merge', mode } }); activeRuns = activeRuns.filter(r => r.id !== run.id); activeRuns.unshift(run); }
    else run = { id: `guest-${mode}-${dateUTC()}`, mode, game: 'merge', seed: mode === 'daily' ? seededGuestDaily(dateUTC()) : localSeed(), challengeDay: mode === 'daily' ? dateUTC() : null, startedAt: stamp() };
    if (mode === 'daily') { daily.started = true; storeGuest(); }
    const saved = read(draftKey(run), {});
    hydrateRun(run, run.reused ? saved.moves || [] : []);
    switchGame('merge');
    setView('play');
  } catch (err) { toast(err.message); } finally { busy = false; renderBoard(); }
}

async function completeGame() {
  if (!state || completed || busy || moves.length < 2) return;
  busy = true; $('bank-btn').disabled = true; setStatus('Verifying and saving your score...');
  lastFinishedGameType = 'merge';
  try {
    let earned, score = state.score;
    if (online) {
      const result = await api('/game/finish', { method: 'POST', body: { id: currentRun.id, moves } });
      earned = result.coinsAwarded; score = result.score;
      player.coins = result.coins; player.bestScore = result.bestScore; player.bestTile = result.bestTile; player.gamesPlayed = result.gamesPlayed;
      activeRuns = activeRuns.filter(run => run.id !== currentRun.id);
    } else {
      const todayEarned = recentGames.filter(g => new Date(g.finishedAt * 1000).toISOString().slice(0, 10) === dateUTC()).reduce((sum, g) => sum + (g.coinsAwarded || 0), 0);
      earned = Math.min(coinsForScore(score), Math.max(0, 60 - todayEarned));
      player.coins += earned; player.bestScore = Math.max(player.bestScore, score); player.bestTile = Math.max(player.bestTile, ...state.board); player.gamesPlayed++;
    }
    erase(draftKey(currentRun));
    if (currentMode === 'daily') { daily.started = true; daily.completed = true; daily.score = score; }
    recentGames.unshift({ score, mode: currentMode, gameType: 'merge', finishedAt: stamp(), coinsAwarded: earned });
    recentGames = recentGames.slice(0, 45);
    player.streak = localStreak();
    storeGuest(); completed = true;
    $('finish-title').textContent = state.over ? 'Board full!' : 'Score saved!';
    $('final-score').textContent = num(score); $('final-coins').textContent = `+${num(earned)}`;
    $('finish-caption').textContent = currentMode === 'daily' ? online ? 'Your daily score is recorded. Come back tomorrow for another challenge.' : 'Your practice daily score stays on this device.' : online ? 'Your verified score counts toward the all-time rankings.' : 'Practice scores and coins stay on this device.';
    $('play-again-btn').textContent = currentMode === 'daily' ? 'Play classic ↻' : 'Play again ↻';
    setStatus('Run saved. Keep playing to improve your best.');
    renderBoard(); renderDashboard(); renderShop();
    $('finish-dialog').showModal();
    if (online) refreshLeaderboard();
  } catch (err) { setStatus('Saving failed. Your game is still stored on this device.'); toast(err.message); }
  finally { busy = false; renderBoard(); }
}

function takeTurn(direction) {
  if (view !== 'play' || activeGame !== 'merge' || !state || completed || busy || state.over) return;
  const result = move(state, direction);
  if (!result.changed) { setStatus('That direction cannot move the tiles.'); return; }
  state = result.state; moves.push(direction); saveDraft(); renderBoard();
  try { tg?.HapticFeedback?.impactOccurred?.(result.gained ? 'medium' : 'light'); } catch {}
  setStatus(result.gained ? `Nice merge! +${result.gained} points` : 'Keep the largest tile near a corner.');
  if (state.over || moves.length >= 1400) { setStatus('Run finished. Saving your score...'); completeGame(); }
}

// ==========================================
// GAME 2: BLOCK COLLAPSE (8x8)
// ==========================================

function createPieceMiniGrid(piece) {
  const grid = el('div', 'mini-piece-grid');
  let maxR = 0, maxC = 0;
  for (const [r, c] of piece.cells) {
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  grid.style.gridTemplateRows = `repeat(${maxR + 1}, 13px)`;
  grid.style.gridTemplateColumns = `repeat(${maxC + 1}, 13px)`;
  const cellSet = new Set(piece.cells.map(([r, c]) => `${r},${c}`));
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      grid.appendChild(el('div', `mini-cell${cellSet.has(`${r},${c}`) ? ' filled' : ''}`));
    }
  }
  return grid;
}

function clearGhostPreview() {
  document.querySelectorAll('.blocks-cell.preview-valid, .blocks-cell.preview-invalid').forEach(c => {
    c.classList.remove('preview-valid', 'preview-invalid');
  });
}

function showGhostPreview(row, col) {
  clearGhostPreview();
  if (selectedRackIndex < 0 || !blocksState || blocksCompleted) return;
  const piece = blocksState.rack[selectedRackIndex];
  if (!piece || piece.used) return;
  const valid = canPlace(blocksState.board, piece, row, col);
  for (const [dr, dc] of piece.cells) {
    const r = row + dr, c = col + dc;
    if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
      const cell = document.querySelector(`.blocks-cell[data-row="${r}"][data-col="${c}"]`);
      if (cell) cell.classList.add(valid ? 'preview-valid' : 'preview-invalid');
    }
  }
}

function renderBlocksUI() {
  if (!blocksState) return;
  $('blocks-score').textContent = num(blocksState.score);
  $('blocks-best').textContent = num(Math.max(player.bestBlocksScore || 0, blocksState.score));
  $('blocks-lines').textContent = num(blocksState.linesCleared);
  $('blocks-streak-tag').textContent = `COMBO ${blocksState.streak}×`;
  $('blocks-moves-counter').textContent = `${num(blocksMoves.length)} MOVES`;
  $('blocks-bank-btn').disabled = blocksBusy || blocksCompleted || blocksMoves.length < 1;
  $('blocks-new-game-btn').disabled = blocksBusy;
  $('blocks-state-chip').textContent = blocksCompleted ? 'SCORE SAVED' : blocksState.over ? 'BOARD FULL' : blocksState.streak > 1 ? `COMBO ×${blocksState.streak}` : 'READY TO PLACE';

  // Render 8x8 Board
  const board = $('blocks-board');
  const frag = document.createDocumentFragment();
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const idx = r * GRID_SIZE + c;
      const isFilled = blocksState.board[idx] === 1;
      const cell = el('div', `blocks-cell${isFilled ? ' filled' : ''}`);
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `Row ${r + 1}, col ${c + 1}: ${isFilled ? 'filled' : 'empty'}`);

      cell.addEventListener('pointerenter', () => showGhostPreview(r, c));
      cell.addEventListener('pointerleave', () => clearGhostPreview());
      cell.addEventListener('click', () => handleBoardCellClick(r, c));
      frag.appendChild(cell);
    }
  }
  board.replaceChildren(frag);

  // Render Rack
  const rack = $('blocks-rack');
  const rackFrag = document.createDocumentFragment();
  const remaining = blocksState.rack.filter(p => !p.used).length;
  $('blocks-rack-info').textContent = `${remaining} piece${remaining !== 1 ? 's' : ''}`;

  blocksState.rack.forEach((piece, idx) => {
    const slot = el('div', `rack-piece${piece.used ? ' used' : ''}${idx === selectedRackIndex ? ' selected' : ''}`);
    slot.dataset.rackIndex = String(idx);
    slot.setAttribute('role', 'button');
    slot.setAttribute('aria-label', `${piece.name}${piece.used ? ' (used)' : idx === selectedRackIndex ? ' (selected)' : ''}`);

    if (!piece.used) {
      slot.appendChild(createPieceMiniGrid(piece));
      slot.addEventListener('click', () => {
        if (piece.used) return;
        if (selectedRackIndex === idx) {
          selectedRackIndex = -1;
          $('blocks-status').textContent = 'Piece unselected. Tap a piece to choose it.';
        } else {
          selectedRackIndex = idx;
          try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
          $('blocks-status').textContent = `Selected ${piece.name}. Now tap the grid where you want to place it!`;
        }
        renderBlocksUI();
      });
    } else {
      slot.appendChild(el('span', 'mini-cell', ''));
    }
    rackFrag.appendChild(slot);
  });
  rack.replaceChildren(rackFrag);

  renderProfileBase();
}

function handleBoardCellClick(row, col) {
  if (view !== 'play' || activeGame !== 'blocks' || !blocksState || blocksCompleted || blocksBusy) return;
  if (selectedRackIndex < 0) {
    $('blocks-status').textContent = 'Please tap a piece below first to select it!';
    return;
  }
  const piece = blocksState.rack[selectedRackIndex];
  if (!piece || piece.used) { selectedRackIndex = -1; renderBlocksUI(); return; }

  if (!canPlace(blocksState.board, piece, row, col)) {
    $('blocks-status').textContent = 'Piece does not fit there. Choose another spot on the grid!';
    try { tg?.HapticFeedback?.notificationOccurred?.('error'); } catch {}
    return;
  }

  const result = placeBlock(blocksState, selectedRackIndex, row, col);
  if (!result.valid) return;

  blocksState = result.state;
  blocksMoves.push({ rackIndex: selectedRackIndex, row, col });
  saveBlocksDraft();
  selectedRackIndex = -1;
  clearGhostPreview();

  try { tg?.HapticFeedback?.impactOccurred?.('medium'); } catch {}

  if (result.clearedCount > 0) {
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
    $('blocks-status').textContent = `Boom! Cleared ${result.clearedCount} line${result.clearedCount > 1 ? 's' : ''}! +${result.pointsGained} pts`;
  } else {
    $('blocks-status').textContent = `Placed! +${result.pointsGained} pts. Select your next piece.`;
  }

  renderBlocksUI();

  if (blocksState.over) {
    $('blocks-status').textContent = 'No more pieces can fit! Saving your run...';
    completeBlocksGame();
  }
}

function hydrateBlocksRun(run, history) {
  currentBlocksRun = { ...run, game: 'blocks', mode: 'classic' };
  blocksMoves = Array.isArray(history) ? history : [];
  try {
    blocksState = replayBlocks(run.seed, blocksMoves);
  } catch {
    blocksMoves = [];
    blocksState = newBlocksGame(run.seed);
  }
  blocksCompleted = false;
  selectedRackIndex = -1;
  saveBlocksDraft();
  renderBlocksUI();
  $('blocks-status').textContent = 'Tap any shape below, then tap the grid to place it!';
}

async function launchBlocks(newRun = false) {
  if (blocksBusy) return;
  if (!newRun && currentBlocksRun && !blocksCompleted) {
    switchGame('blocks');
    setView('play');
    return;
  }
  if (!newRun && !online) {
    const draft = read('ms_demo_blocks_run');
    if (draft && Number.isInteger(draft.seed)) {
      hydrateBlocksRun(draft, draft.moves);
      switchGame('blocks');
      setView('play');
      return;
    }
  }
  if (!newRun && online) {
    const active = activeRuns.find(r => r.gameType === 'blocks');
    if (active) {
      const saved = read(`ms_blocks_run_${player.id}_${active.id}`, {});
      hydrateBlocksRun(active, saved.moves || []);
      switchGame('blocks');
      setView('play');
      return;
    }
  }

  if (newRun && currentBlocksRun && !blocksCompleted && blocksMoves.length > 0 && !confirm('Start a new game of Block Collapse? Your unfinished run will be abandoned.')) return;

  blocksBusy = true;
  try {
    let run;
    if (online) {
      run = await api('/game/start', { method: 'POST', body: { game: 'blocks', mode: 'classic' } });
      activeRuns = activeRuns.filter(r => r.id !== run.id);
      activeRuns.unshift(run);
    } else {
      run = { id: `guest-blocks-${stamp()}`, mode: 'classic', game: 'blocks', seed: localSeed(), startedAt: stamp() };
    }
    const saved = read(draftKeyBlocks(run), {});
    hydrateBlocksRun(run, run.reused ? saved.moves || [] : []);
    switchGame('blocks');
    setView('play');
  } catch (err) {
    toast(err.message);
  } finally {
    blocksBusy = false;
    renderBlocksUI();
  }
}

async function completeBlocksGame() {
  if (!blocksState || blocksCompleted || blocksBusy || blocksMoves.length < 1) return;
  blocksBusy = true;
  $('blocks-bank-btn').disabled = true;
  $('blocks-status').textContent = 'Verifying and saving your blocks score...';
  lastFinishedGameType = 'blocks';

  try {
    let earned, score = blocksState.score;
    if (online) {
      const result = await api('/game/finish', { method: 'POST', body: { id: currentBlocksRun.id, moves: blocksMoves } });
      earned = result.coinsAwarded;
      score = result.score;
      player.coins = result.coins;
      player.bestBlocksScore = result.bestBlocksScore;
      player.gamesPlayed = result.gamesPlayed;
      activeRuns = activeRuns.filter(run => run.id !== currentBlocksRun.id);
    } else {
      const todayEarned = recentGames.filter(g => new Date(g.finishedAt * 1000).toISOString().slice(0, 10) === dateUTC()).reduce((sum, g) => sum + (g.coinsAwarded || 0), 0);
      earned = Math.min(coinsForBlocksScore(score), Math.max(0, 60 - todayEarned));
      player.coins += earned;
      player.bestBlocksScore = Math.max(player.bestBlocksScore || 0, score);
      player.gamesPlayed++;
    }

    erase(draftKeyBlocks(currentBlocksRun));
    recentGames.unshift({ score, mode: 'classic', gameType: 'blocks', finishedAt: stamp(), coinsAwarded: earned });
    recentGames = recentGames.slice(0, 45);
    player.streak = localStreak();
    storeGuest();
    blocksCompleted = true;

    $('finish-title').textContent = blocksState.over ? 'Board full!' : 'Score saved!';
    $('final-score').textContent = num(score);
    $('final-coins').textContent = `+${num(earned)}`;
    $('finish-caption').textContent = online ? 'Your verified score counts toward the Block Collapse rankings.' : 'Practice scores and coins stay on this device.';
    $('play-again-btn').textContent = 'Play again ↻';
    $('blocks-status').textContent = 'Run saved. Keep playing to climb higher!';

    renderBlocksUI();
    renderDashboard();
    renderShop();
    $('finish-dialog').showModal();
    if (online) refreshLeaderboard();
  } catch (err) {
    $('blocks-status').textContent = 'Saving failed. Your game remains stored locally.';
    toast(err.message);
  } finally {
    blocksBusy = false;
    renderBlocksUI();
  }
}

// ==========================================
// GAME 3: COLOR CASCADE (7x7 MATCH-3)
// ==========================================

function renderCascadeUI() {
  if (!cascadeState) return;
  $('cascade-score').textContent = num(cascadeState.score);
  $('cascade-best').textContent = num(Math.max(player.bestCascadeScore || 0, cascadeState.score));
  $('cascade-moves-left').textContent = String(Math.max(0, MAX_MOVES - cascadeState.moves));
  $('cascade-streak-tag').textContent = `COMBO ${cascadeState.streak}×`;
  $('cascade-clears-counter').textContent = `${num(cascadeState.totalClears)} CLEARS`;
  $('cascade-bank-btn').disabled = cascadeBusy || cascadeCompleted || cascadeMoves.length < 1;
  $('cascade-new-game-btn').disabled = cascadeBusy;
  $('cascade-state-chip').textContent = cascadeCompleted ? 'SCORE SAVED' : cascadeState.over ? 'NO MOVES LEFT' : cascadeState.streak > 1 ? `COMBO ×${cascadeState.streak}` : 'SWAP GEMS';

  // Render 7x7 Board
  const board = $('cascade-board');
  const frag = document.createDocumentFragment();
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const idx = r * BOARD_SIZE + c;
      const val = cascadeState.board[idx];
      const gem = GEMS[val] || GEMS[0];
      const isSelected = selectedGemCoord && selectedGemCoord.r === r && selectedGemCoord.c === c;
      const cell = el('div', `gem-cell gem-${val}${isSelected ? ' selected' : ''}`);
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.textContent = gem.symbol;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `Row ${r + 1}, col ${c + 1}: ${gem.name}${isSelected ? ' (selected)' : ''}`);

      cell.addEventListener('click', () => handleGemClick(r, c));
      frag.appendChild(cell);
    }
  }
  board.replaceChildren(frag);

  renderProfileBase();
}

function handleGemClick(r, c) {
  if (view !== 'play' || activeGame !== 'cascade' || !cascadeState || cascadeCompleted || cascadeBusy || cascadeState.over) return;

  if (!selectedGemCoord) {
    selectedGemCoord = { r, c };
    try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
    const gem = GEMS[cascadeState.board[r * BOARD_SIZE + c]];
    $('cascade-status').textContent = `Selected ${gem.name} at row ${r + 1}, col ${c + 1}. Now tap an adjacent neighbor to swap!`;
    renderCascadeUI();
    return;
  }

  const { r: r1, c: c1 } = selectedGemCoord;

  // Deselect if tapped same gem
  if (r1 === r && c1 === c) {
    selectedGemCoord = null;
    $('cascade-status').textContent = 'Gem deselected. Tap any gem to start a swap.';
    renderCascadeUI();
    return;
  }

  // If not adjacent (Manhattan distance !== 1), switch selection
  if (Math.abs(r1 - r) + Math.abs(c1 - c) !== 1) {
    selectedGemCoord = { r, c };
    try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
    const gem = GEMS[cascadeState.board[r * BOARD_SIZE + c]];
    $('cascade-status').textContent = `Selected ${gem.name}. Tap an adjacent gem to swap!`;
    renderCascadeUI();
    return;
  }

  // Attempt swap
  const result = swapGems(cascadeState, r1, c1, r, c);
  if (!result.valid) {
    $('cascade-status').textContent = 'No match there! Swapped back. Choose another swap.';
    try { tg?.HapticFeedback?.notificationOccurred?.('error'); } catch {}
    selectedGemCoord = null;
    renderCascadeUI();
    return;
  }

  // Valid swap!
  cascadeState = result.state;
  cascadeMoves.push({ r1, c1, r2: r, c2: c });
  saveCascadeDraft();
  selectedGemCoord = null;

  try { tg?.HapticFeedback?.impactOccurred?.('medium'); } catch {}

  if (result.cascades > 1) {
    try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
    $('cascade-status').textContent = `Mega Cascade! ${result.cascades}× combo! +${result.pointsGained} pts`;
  } else {
    $('cascade-status').textContent = `Match cleared! +${result.pointsGained} pts. Keep going!`;
  }

  renderCascadeUI();

  if (cascadeState.over) {
    $('cascade-status').textContent = 'All 30 moves used! Saving your score...';
    completeCascadeGame();
  }
}

function hydrateCascadeRun(run, history) {
  currentCascadeRun = { ...run, game: 'cascade', mode: 'classic' };
  cascadeMoves = Array.isArray(history) ? history : [];
  try {
    cascadeState = replayColors(run.seed, cascadeMoves);
  } catch {
    cascadeMoves = [];
    cascadeState = newColorGame(run.seed);
  }
  cascadeCompleted = false;
  selectedGemCoord = null;
  saveCascadeDraft();
  renderCascadeUI();
  $('cascade-status').textContent = 'Tap any gem to select, then tap an adjacent neighbor to swap!';
}

async function launchCascade(newRun = false) {
  if (cascadeBusy) return;
  if (!newRun && currentCascadeRun && !cascadeCompleted) {
    switchGame('cascade');
    setView('play');
    return;
  }
  if (!newRun && !online) {
    const draft = read('ms_demo_cascade_run');
    if (draft && Number.isInteger(draft.seed)) {
      hydrateCascadeRun(draft, draft.moves);
      switchGame('cascade');
      setView('play');
      return;
    }
  }
  if (!newRun && online) {
    const active = activeRuns.find(r => r.gameType === 'cascade');
    if (active) {
      const saved = read(`ms_cascade_run_${player.id}_${active.id}`, {});
      hydrateCascadeRun(active, saved.moves || []);
      switchGame('cascade');
      setView('play');
      return;
    }
  }

  if (newRun && currentCascadeRun && !cascadeCompleted && cascadeMoves.length > 0 && !confirm('Start a new game of Color Cascade? Your unfinished run will be abandoned.')) return;

  cascadeBusy = true;
  try {
    let run;
    if (online) {
      run = await api('/game/start', { method: 'POST', body: { game: 'cascade', mode: 'classic' } });
      activeRuns = activeRuns.filter(r => r.id !== run.id);
      activeRuns.unshift(run);
    } else {
      run = { id: `guest-cascade-${stamp()}`, mode: 'classic', game: 'cascade', seed: localSeed(), startedAt: stamp() };
    }
    const saved = read(draftKeyCascade(run), {});
    hydrateCascadeRun(run, run.reused ? saved.moves || [] : []);
    switchGame('cascade');
    setView('play');
  } catch (err) {
    toast(err.message);
  } finally {
    cascadeBusy = false;
    renderCascadeUI();
  }
}

async function completeCascadeGame() {
  if (!cascadeState || cascadeCompleted || cascadeBusy || cascadeMoves.length < 1) return;
  cascadeBusy = true;
  $('cascade-bank-btn').disabled = true;
  $('cascade-status').textContent = 'Verifying and saving your cascade score...';
  lastFinishedGameType = 'cascade';

  try {
    let earned, score = cascadeState.score;
    if (online) {
      const result = await api('/game/finish', { method: 'POST', body: { id: currentCascadeRun.id, moves: cascadeMoves } });
      earned = result.coinsAwarded;
      score = result.score;
      player.coins = result.coins;
      player.bestCascadeScore = result.bestCascadeScore;
      player.gamesPlayed = result.gamesPlayed;
      activeRuns = activeRuns.filter(run => run.id !== currentCascadeRun.id);
    } else {
      const todayEarned = recentGames.filter(g => new Date(g.finishedAt * 1000).toISOString().slice(0, 10) === dateUTC()).reduce((sum, g) => sum + (g.coinsAwarded || 0), 0);
      earned = Math.min(coinsForColorsScore(score), Math.max(0, 60 - todayEarned));
      player.coins += earned;
      player.bestCascadeScore = Math.max(player.bestCascadeScore || 0, score);
      player.gamesPlayed++;
    }

    erase(draftKeyCascade(currentCascadeRun));
    recentGames.unshift({ score, mode: 'classic', gameType: 'cascade', finishedAt: stamp(), coinsAwarded: earned });
    recentGames = recentGames.slice(0, 45);
    player.streak = localStreak();
    storeGuest();
    cascadeCompleted = true;

    $('finish-title').textContent = cascadeState.over ? 'Run finished!' : 'Score saved!';
    $('final-score').textContent = num(score);
    $('final-coins').textContent = `+${num(earned)}`;
    $('finish-caption').textContent = online ? 'Your verified score counts toward the Color Cascade rankings.' : 'Practice scores and coins stay on this device.';
    $('play-again-btn').textContent = 'Play again ↻';
    $('cascade-status').textContent = 'Run saved. Keep playing to climb higher!';

    renderCascadeUI();
    renderDashboard();
    renderShop();
    $('finish-dialog').showModal();
    if (online) refreshLeaderboard();
  } catch (err) {
    $('cascade-status').textContent = 'Saving failed. Your game remains stored locally.';
    toast(err.message);
  } finally {
    cascadeBusy = false;
    renderCascadeUI();
  }
}

// ==========================================
// GAME 4: MEMORY MATRIX (3x3 PATTERN REPEAT)
// ==========================================

let audioCtx = null;
function playPadTone(padIndex, duration = 0.22) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const pad = PADS[padIndex];
    if (!pad) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pad.freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch {}
}

function flashPad(padIndex, duration = 280) {
  const padEl = document.querySelector(`.memory-pad[data-pad="${padIndex}"]`);
  if (!padEl) return;
  padEl.classList.add('pad-active');
  playPadTone(padIndex, duration / 1000);
  setTimeout(() => {
    padEl.classList.remove('pad-active');
  }, duration);
}

function renderMemoryUI() {
  if (!memoryState) return;

  $('memory-score').textContent = num(memoryState.score);
  $('memory-best').textContent = num(player.bestMemoryScore || 0);

  const livesStr = memoryState.lives > 0 ? '❤️'.repeat(memoryState.lives) : '💀 Game Over';
  $('memory-lives').textContent = livesStr;

  $('memory-round-tag').textContent = `ROUND ${memoryState.round}`;
  $('memory-streak-counter').textContent = `${memoryState.streak} STREAK`;

  $('memory-state-chip').textContent = memoryState.over ? 'GAME OVER' : isPlayingSequence ? 'WATCH PATTERN' : 'YOUR TURN';
  $('memory-bank-btn').disabled = !memoryMoves.length || memoryCompleted || memoryBusy || isPlayingSequence;

  const boardEl = $('memory-board');
  if (boardEl.children.length !== NUM_PADS) {
    clear(boardEl);
    PADS.forEach(pad => {
      const padEl = el('button', `memory-pad pad-${pad.id}`);
      padEl.dataset.pad = String(pad.id);
      padEl.setAttribute('aria-label', `Pad ${pad.id + 1}: ${pad.name}`);

      const glyph = el('span', 'pad-glyph', pad.symbol);
      const label = el('span', 'pad-label', pad.name.toUpperCase());
      padEl.append(glyph, label);

      padEl.addEventListener('click', () => handlePadClick(pad.id));
      boardEl.append(padEl);
    });
  }
}

async function playCurrentSequence() {
  if (!memoryState || memoryCompleted) return;
  isPlayingSequence = true;
  renderMemoryUI();
  $('memory-status').textContent = `Round ${memoryState.round}: Watch the pattern closely...`;

  const roundLength = memoryState.round;
  const speed = Math.max(260, 480 - roundLength * 8);

  for (let i = 0; i < roundLength; i++) {
    if (!memoryState || memoryCompleted) break;
    await new Promise(r => setTimeout(r, speed * 0.35));
    flashPad(memoryState.sequence[i], speed * 0.7);
    await new Promise(r => setTimeout(r, speed * 0.75));
  }

  isPlayingSequence = false;
  if (memoryState && !memoryCompleted) {
    renderMemoryUI();
    $('memory-status').textContent = `Your turn! Tap the ${roundLength} pad${roundLength > 1 ? 's' : ''} in exact sequence.`;
  }
}

function handlePadClick(padIndex) {
  if (!memoryState || memoryCompleted || memoryBusy || isPlayingSequence) return;

  flashPad(padIndex, 200);
  try { tg?.HapticFeedback?.impactOccurred?.('light'); } catch {}

  const result = tapPad(memoryState, padIndex);
  memoryState = result.state;
  memoryMoves.push({ pad: padIndex });
  saveMemoryDraft();

  if (result.correct) {
    if (result.roundCleared) {
      try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch {}
      $('memory-status').textContent = `Round ${memoryState.round - 1} Cleared! +${result.pointsGained} pts! Next round starting...`;
      renderMemoryUI();
      if (memoryState.over) {
        completeMemoryGame();
      } else {
        setTimeout(() => {
          renderMemoryUI();
          playCurrentSequence();
        }, 800);
      }
    } else {
      const remaining = memoryState.round - memoryState.step;
      $('memory-status').textContent = `Correct! ${remaining} step${remaining > 1 ? 's' : ''} left in this round.`;
      renderMemoryUI();
    }
  } else {
    // Mistake
    try { tg?.HapticFeedback?.notificationOccurred?.('error'); } catch {}
    const padEl = document.querySelector(`.memory-pad[data-pad="${padIndex}"]`);
    if (padEl) {
      padEl.classList.add('pad-error');
      setTimeout(() => padEl.classList.remove('pad-error'), 400);
    }

    if (memoryState.over) {
      $('memory-status').textContent = 'Out of lives! Game over. Saving score...';
      renderMemoryUI();
      completeMemoryGame();
    } else {
      $('memory-status').textContent = `Wrong pad! -1 life (${memoryState.lives} left). Repeating round sequence...`;
      renderMemoryUI();
      setTimeout(() => {
        playCurrentSequence();
      }, 900);
    }
  }
}

function hydrateMemoryRun(run, history) {
  currentMemoryRun = { ...run, game: 'memory', mode: 'classic' };
  memoryMoves = Array.isArray(history) ? history : [];
  try {
    memoryState = replayMemory(run.seed, memoryMoves);
  } catch {
    memoryMoves = [];
    memoryState = newMemoryGame(run.seed);
  }
  memoryCompleted = false;
  saveMemoryDraft();
  renderMemoryUI();
  if (!memoryState.over && memoryMoves.length === 0) {
    setTimeout(() => playCurrentSequence(), 400);
  } else {
    $('memory-status').textContent = 'Run restored. Repeat the sequence to advance!';
  }
}

async function launchMemory(newRun = false) {
  if (memoryBusy) return;
  if (!newRun && currentMemoryRun && !memoryCompleted) {
    switchGame('memory');
    setView('play');
    return;
  }
  if (!newRun && !online) {
    const draft = read('ms_demo_memory_run');
    if (draft && Number.isInteger(draft.seed)) {
      hydrateMemoryRun(draft, draft.moves);
      switchGame('memory');
      setView('play');
      return;
    }
  }

  memoryBusy = true;
  $('memory-new-game-btn').disabled = true;
  $('memory-status').textContent = 'Starting new Memory Matrix run...';

  try {
    let run;
    if (online) {
      run = await api('/game/start', { method: 'POST', body: { game: 'memory', mode: 'classic' } });
      activeRuns.unshift({ id: run.id, seed: run.seed, gameType: 'memory', mode: 'classic', startedAt: run.startedAt });
    } else {
      run = { id: `guest-memory-${stamp()}`, seed: localSeed(), game: 'memory', mode: 'classic', startedAt: stamp() };
    }
    hydrateMemoryRun(run, []);
    switchGame('memory');
    setView('play');
  } catch (err) {
    $('memory-status').textContent = 'Could not start new run. Try again.';
    toast(err.message);
  } finally {
    memoryBusy = false;
    $('memory-new-game-btn').disabled = false;
    renderMemoryUI();
  }
}

async function completeMemoryGame() {
  if (!memoryState || memoryCompleted || memoryBusy || memoryMoves.length < 1) return;
  memoryBusy = true;
  $('memory-bank-btn').disabled = true;
  $('memory-status').textContent = 'Verifying and saving your memory score...';
  lastFinishedGameType = 'memory';

  try {
    let earned, score = memoryState.score;
    if (online) {
      const result = await api('/game/finish', { method: 'POST', body: { id: currentMemoryRun.id, moves: memoryMoves } });
      earned = result.coinsAwarded;
      score = result.score;
      player.coins = result.coins;
      player.bestMemoryScore = result.bestMemoryScore;
      player.gamesPlayed = result.gamesPlayed;
      activeRuns = activeRuns.filter(run => run.id !== currentMemoryRun.id);
    } else {
      const todayEarned = recentGames.filter(g => new Date(g.finishedAt * 1000).toISOString().slice(0, 10) === dateUTC()).reduce((sum, g) => sum + (g.coinsAwarded || 0), 0);
      earned = Math.min(coinsForMemoryScore(score), Math.max(0, 60 - todayEarned));
      player.coins += earned;
      player.bestMemoryScore = Math.max(player.bestMemoryScore || 0, score);
      player.gamesPlayed++;
    }

    erase(draftKeyMemory(currentMemoryRun));
    recentGames.unshift({ score, mode: 'classic', gameType: 'memory', finishedAt: stamp(), coinsAwarded: earned });
    recentGames = recentGames.slice(0, 45);
    player.streak = localStreak();
    storeGuest();
    memoryCompleted = true;

    $('finish-title').textContent = memoryState.over ? 'Run finished!' : 'Score saved!';
    $('final-score').textContent = num(score);
    $('final-coins').textContent = `+${num(earned)}`;
    $('finish-caption').textContent = online ? 'Your verified score counts toward the Memory Matrix rankings.' : 'Practice scores and coins stay on this device.';
    $('play-again-btn').textContent = 'Play again ↻';
    $('memory-status').textContent = 'Run saved. Sharpen your memory and try again!';

    renderMemoryUI();
    renderDashboard();
    renderShop();
    $('finish-dialog').showModal();
    if (online) refreshLeaderboard();
  } catch (err) {
    $('memory-status').textContent = 'Saving failed. Your game remains stored locally.';
    toast(err.message);
  } finally {
    memoryBusy = false;
    renderMemoryUI();
  }
}

// ==========================================
// GAME 5: NEON VIPER (16x16 REFLEX SNAKE)
// ==========================================

function playPelletChime() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(659.25, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.14);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.14);
  } catch {}
}

function playCrashBuzz() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, audioCtx.currentTime + 0.28);
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch {}
}

function renderViperUI() {
  if (!viperState) return;

  $('viper-score').textContent = num(viperState.score);
  $('viper-best').textContent = num(player.bestViperScore || 0);
  $('viper-length').textContent = num(viperState.snake.length);
  $('viper-food-counter').textContent = `${viperState.foodEaten} PELLETS`;

  const speedMs = Math.max(75, 125 - Math.floor(viperState.foodEaten / 3) * 4);
  $('viper-speed-tag').textContent = speedMs < 95 ? 'WARP SPEED' : speedMs < 115 ? 'FAST SPEED' : 'NORMAL SPEED';

  $('viper-state-chip').textContent = viperState.over ? 'GAME OVER' : 'SLITHERING';
  $('viper-bank-btn').disabled = !viperMoves.length || viperCompleted || viperBusy;

  renderViperCanvas();
}

function renderViperCanvas() {
  const canvas = $('viper-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const cellSize = size / VIPER_GRID_SIZE;

  // Background clear
  ctx.fillStyle = '#080f18';
  ctx.fillRect(0, 0, size, size);

  // Subtle cyber grid
  ctx.strokeStyle = '#121e2c';
  ctx.lineWidth = 1;
  for (let i = 1; i < VIPER_GRID_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellSize, 0);
    ctx.lineTo(i * cellSize, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * cellSize);
    ctx.lineTo(size, i * cellSize);
    ctx.stroke();
  }

  if (!viperState) return;

  // Glowing energy food pellet
  if (viperState.food) {
    const fx = viperState.food.c * cellSize + cellSize / 2;
    const fy = viperState.food.r * cellSize + cellSize / 2;
    const radius = cellSize * 0.38;

    const grad = ctx.createRadialGradient(fx, fy, 2, fx, fy, cellSize * 0.9);
    grad.addColorStop(0, '#ff007f');
    grad.addColorStop(0.5, 'rgba(255, 0, 127, 0.45)');
    grad.addColorStop(1, 'rgba(255, 0, 127, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(fx, fy, cellSize * 0.9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ff4da6';
    ctx.beginPath();
    ctx.arc(fx, fy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(fx - radius * 0.3, fy - radius * 0.3, radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw snake body
  const len = viperState.snake.length;
  for (let i = len - 1; i >= 0; i--) {
    const seg = viperState.snake[i];
    const x = seg.c * cellSize;
    const y = seg.r * cellSize;
    const pad = 2;

    if (i === 0) {
      // Head
      ctx.fillStyle = '#36e2b6';
      ctx.shadowColor = '#00f0a8';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.roundRect(x + pad, y + pad, cellSize - pad * 2, cellSize - pad * 2, 7);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Cute directional eyes
      ctx.fillStyle = '#08171d';
      const eyeR = 2.4;
      let e1x = x + cellSize / 2, e1y = y + cellSize / 2;
      let e2x = x + cellSize / 2, e2y = y + cellSize / 2;

      if (viperState.dir === 'right') {
        e1x = x + cellSize * 0.68; e1y = y + cellSize * 0.28;
        e2x = x + cellSize * 0.68; e2y = y + cellSize * 0.72;
      } else if (viperState.dir === 'left') {
        e1x = x + cellSize * 0.32; e1y = y + cellSize * 0.28;
        e2x = x + cellSize * 0.32; e2y = y + cellSize * 0.72;
      } else if (viperState.dir === 'up') {
        e1x = x + cellSize * 0.28; e1y = y + cellSize * 0.32;
        e2x = x + cellSize * 0.72; e2y = y + cellSize * 0.32;
      } else {
        e1x = x + cellSize * 0.28; e1y = y + cellSize * 0.68;
        e2x = x + cellSize * 0.72; e2y = y + cellSize * 0.68;
      }

      ctx.beginPath(); ctx.arc(e1x, e1y, eyeR, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(e2x, e2y, eyeR, 0, Math.PI * 2); ctx.fill();
    } else {
      // Body segment gradient
      const ratio = i / len;
      ctx.fillStyle = `hsl(${165 - ratio * 45}, 90%, ${55 - ratio * 15}%)`;
      ctx.beginPath();
      ctx.roundRect(x + pad + 1, y + pad + 1, cellSize - (pad + 1) * 2, cellSize - (pad + 1) * 2, 5);
      ctx.fill();
    }
  }
}

function setViperDirection(dir) {
  if (!viperState || viperState.over || viperCompleted) return;
  const opp = { up: 'down', down: 'up', left: 'right', right: 'left' };
  if (opp[dir] !== viperState.dir) {
    viperNextDir = dir;
    try { tg?.HapticFeedback?.selectionChanged?.(); } catch {}
  }
}

function viperTick() {
  if (!viperState || viperState.over || viperCompleted) {
    stopViperLoop();
    return;
  }

  const prevFoodCount = viperState.foodEaten;
  viperState = stepSnake(viperState, viperNextDir);
  viperMoves.push(viperNextDir);
  saveViperDraft();

  if (viperState.foodEaten > prevFoodCount) {
    playPelletChime();
    try { tg?.HapticFeedback?.impactOccurred?.('medium'); } catch {}
    $('viper-status').textContent = `Energy pellet absorbed! Length ${viperState.snake.length} · +${100 + viperState.foodEaten * 15} pts`;
  }

  renderViperUI();

  if (viperState.over) {
    stopViperLoop();
    playCrashBuzz();
    try { tg?.HapticFeedback?.notificationOccurred?.('error'); } catch {}
    $('viper-status').textContent = 'Collision! Viper crashed. Saving your score...';
    completeViperGame();
    return;
  }

  const speedMs = Math.max(75, 125 - Math.floor(viperState.foodEaten / 3) * 4);
  viperLoopTimer = setTimeout(viperTick, speedMs);
}

function startViperLoop() {
  stopViperLoop();
  if (viperState && !viperState.over && !viperCompleted && activeGame === 'viper' && view === 'play') {
    const speedMs = Math.max(75, 125 - Math.floor(viperState.foodEaten / 3) * 4);
    viperLoopTimer = setTimeout(viperTick, speedMs);
  }
}

function stopViperLoop() {
  if (viperLoopTimer) {
    clearTimeout(viperLoopTimer);
    viperLoopTimer = null;
  }
}

function hydrateViperRun(run, history) {
  currentViperRun = { ...run, game: 'viper', mode: 'classic' };
  viperMoves = Array.isArray(history) ? history : [];
  try {
    viperState = replayViper(run.seed, viperMoves);
  } catch {
    viperMoves = [];
    viperState = newViperGame(run.seed);
  }
  viperNextDir = viperState.dir;
  viperCompleted = false;
  saveViperDraft();
  renderViperUI();
  $('viper-status').textContent = viperState.over ? 'Game over. Tap New Run to slither again!' : 'Viper ready. Steer to collect pellets and grow!';
  if (!viperState.over && activeGame === 'viper' && view === 'play') {
    startViperLoop();
  }
}

async function launchViper(newRun = false) {
  if (viperBusy) return;
  if (!newRun && currentViperRun && !viperCompleted && !viperState?.over) {
    switchGame('viper');
    setView('play');
    startViperLoop();
    return;
  }
  if (!newRun && !online) {
    const draft = read('ms_demo_viper_run');
    if (draft && Number.isInteger(draft.seed)) {
      hydrateViperRun(draft, draft.moves);
      switchGame('viper');
      setView('play');
      return;
    }
  }

  stopViperLoop();
  viperBusy = true;
  $('viper-new-game-btn').disabled = true;
  $('viper-status').textContent = 'Starting new Neon Viper run...';

  try {
    let run;
    if (online) {
      run = await api('/game/start', { method: 'POST', body: { game: 'viper', mode: 'classic' } });
      activeRuns.unshift({ id: run.id, seed: run.seed, gameType: 'viper', mode: 'classic', startedAt: run.startedAt });
    } else {
      run = { id: `guest-viper-${stamp()}`, seed: localSeed(), game: 'viper', mode: 'classic', startedAt: stamp() };
    }
    hydrateViperRun(run, []);
    switchGame('viper');
    setView('play');
  } catch (err) {
    $('viper-status').textContent = 'Could not start new run. Try again.';
    toast(err.message);
  } finally {
    viperBusy = false;
    $('viper-new-game-btn').disabled = false;
    renderViperUI();
  }
}

async function completeViperGame() {
  stopViperLoop();
  if (!viperState || viperCompleted || viperBusy || viperMoves.length < 1) return;
  viperBusy = true;
  $('viper-bank-btn').disabled = true;
  $('viper-status').textContent = 'Verifying and saving your viper score...';
  lastFinishedGameType = 'viper';

  try {
    let earned, score = viperState.score;
    if (online) {
      const result = await api('/game/finish', { method: 'POST', body: { id: currentViperRun.id, moves: viperMoves } });
      earned = result.coinsAwarded;
      score = result.score;
      player.coins = result.coins;
      player.bestViperScore = result.bestViperScore;
      player.gamesPlayed = result.gamesPlayed;
      activeRuns = activeRuns.filter(run => run.id !== currentViperRun.id);
    } else {
      const todayEarned = recentGames.filter(g => new Date(g.finishedAt * 1000).toISOString().slice(0, 10) === dateUTC()).reduce((sum, g) => sum + (g.coinsAwarded || 0), 0);
      earned = Math.min(coinsForViperScore(score), Math.max(0, 60 - todayEarned));
      player.coins += earned;
      player.bestViperScore = Math.max(player.bestViperScore || 0, score);
      player.gamesPlayed++;
    }

    erase(draftKeyViper(currentViperRun));
    recentGames.unshift({ score, mode: 'classic', gameType: 'viper', finishedAt: stamp(), coinsAwarded: earned });
    recentGames = recentGames.slice(0, 45);
    player.streak = localStreak();
    storeGuest();
    viperCompleted = true;

    $('finish-title').textContent = viperState.over ? 'Run finished!' : 'Score saved!';
    $('final-score').textContent = num(score);
    $('final-coins').textContent = `+${num(earned)}`;
    $('finish-caption').textContent = online ? 'Your verified score counts toward the Neon Viper rankings.' : 'Practice scores and coins stay on this device.';
    $('play-again-btn').textContent = 'Play again ↻';
    $('viper-status').textContent = 'Run saved. Can you beat your personal best?';

    renderViperUI();
    renderDashboard();
    renderShop();
    $('finish-dialog').showModal();
    if (online) refreshLeaderboard();
  } catch (err) {
    $('viper-status').textContent = 'Saving failed. Your game remains stored locally.';
    toast(err.message);
  } finally {
    viperBusy = false;
    renderViperUI();
  }
}

// ==========================================
// GAME SWITCHING & LEADERBOARDS
// ==========================================

function switchGame(gameType) {
  stopViperLoop();
  activeGame = gameType === 'blocks' ? 'blocks' : gameType === 'cascade' ? 'cascade' : gameType === 'memory' ? 'memory' : gameType === 'viper' ? 'viper' : 'merge';
  document.querySelectorAll('[data-switch-game]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.switchGame === activeGame);
  });
  $('merge-game-view').style.display = activeGame === 'merge' ? 'block' : 'none';
  $('blocks-game-view').style.display = activeGame === 'blocks' ? 'block' : 'none';
  $('cascade-game-view').style.display = activeGame === 'cascade' ? 'block' : 'none';
  $('memory-game-view').style.display = activeGame === 'memory' ? 'block' : 'none';
  $('viper-game-view').style.display = activeGame === 'viper' ? 'block' : 'none';

  if (activeGame === 'blocks') {
    $('arena-main-title').innerHTML = 'Block <span>Collapse.</span>';
    $('arena-main-desc').textContent = '8×8 line clearer. Place polyominoes, clear lines, stack combos.';
    if (!blocksState) launchBlocks(false);
    else renderBlocksUI();
  } else if (activeGame === 'cascade') {
    $('arena-main-title').innerHTML = 'Color <span>Cascade.</span>';
    $('arena-main-desc').textContent = '7×7 gem swap. Line up 3 or more gems and chain cascading collapses.';
    if (!cascadeState) launchCascade(false);
    else renderCascadeUI();
  } else if (activeGame === 'memory') {
    $('arena-main-title').innerHTML = 'Memory <span>Matrix.</span>';
    $('arena-main-desc').textContent = '3×3 pattern repeat. Watch the neon pads and repeat the sequence.';
    if (!memoryState) launchMemory(false);
    else renderMemoryUI();
  } else if (activeGame === 'viper') {
    $('arena-main-title').innerHTML = 'Neon <span>Viper.</span>';
    $('arena-main-desc').textContent = '16×16 reflex snake. Absorb energy pellets, navigate obstacles, don\'t crash!';
    if (!viperState) launchViper(false);
    else { renderViperUI(); startViperLoop(); }
  } else {
    $('arena-main-title').innerHTML = 'Merge <span>Streak.</span>';
    $('arena-main-desc').textContent = '4×4 number merge. Combine matching tiles to reach 2048 and beyond.';
    if (!state) launch('classic', false);
    else renderBoard();
  }
}

function paintLeaders(list) {
  const target = $('leaderboard'); clear(target);
  if (!list.length) { target.append(el('div', 'empty-state', online ? 'No completed scores yet. Be the first to post a result.' : 'Online rankings require published scores. Open the game in Telegram after deployment.')); return; }
  list.forEach((item, index) => {
    const row = el('div', 'leader');
    row.append(el('span', 'leader-index', String(index + 1).padStart(2, '0')), el('span', 'leader-portrait', String(item.name || 'P')[0].toUpperCase()), el('span', 'leader-name', String(item.name || 'Player').slice(0, 40)), el('strong', 'leader-score', num(item.score)));
    target.append(row);
  });
}

async function refreshLeaderboard() {
  $('rank-date-note').textContent = rankMode === 'daily' ? `UTC challenge · ${dateUTC()}` : 'Verified completed games only';
  const gameName = rankGame === 'blocks' ? 'Block Collapse' : rankGame === 'cascade' ? 'Color Cascade' : rankGame === 'memory' ? 'Memory Matrix' : rankGame === 'viper' ? 'Neon Viper' : 'Merge Streak';
  $('ranking-game-title').textContent = `${gameName} Top 20`;
  const cacheKey = `${rankGame}_${rankMode}`;
  try {
    const result = await api(`/leaderboard?game=${rankGame}&mode=${rankMode}`);
    leaderCache[cacheKey] = result.leaders || [];
    paintLeaders(leaderCache[cacheKey]);
  } catch {
    paintLeaders(leaderCache[cacheKey] || []);
  }
}

async function authenticate() {
  if (!tg?.initData) return false;
  try {
    const res = await api('/auth/telegram', { method: 'POST', body: { initData: tg.initData } });
    if (res?.token) {
      authToken = res.token;
      try { sessionStorage.setItem('ms_auth_token', authToken); } catch {}
    }
    const data = await api('/me');
    online = true;
    player = { ...emptyPlayer(), ...data.player };
    activeRuns = data.activeRuns || [];
    recentGames = data.recentGames || [];
    daily = data.daily || daily;
    applyTheme(player.equippedTheme);
    return true;
  } catch (err) {
    console.warn('Telegram auth error:', err);
    toast('Telegram sign-in unavailable. Practice mode is still playable.');
    return false;
  }
}

// ============================================================================
// WEEKLY AD REVENUE SHARE POOL & 15-SECOND REWARDED AD SYSTEM
// ============================================================================

const SPONSORS = [
  { icon: '⚡', title: 'CryptoPulse Pro', desc: 'Real-time Telegram market signals, automated trading bot and multi-chain tracking in one app.' },
  { icon: '💎', title: 'TonGems Hub', desc: 'Discover trending Jettons, NFT collections, and decentralized staking on The Open Network.' },
  { icon: '🛡️', title: 'ShieldVPN Web3', desc: 'Ultra-fast, private, zero-log decentralized VPN for Telegram Mini Apps and browsing.' },
  { icon: '🚀', title: 'StarLaunch Pad', desc: 'The leading community token launchpad with verified audits and instant Telegram alerts.' }
];

let poolData = {
  weekId: '2026-W46',
  endsAt: Math.floor(Date.now() / 1000) + 345600,
  communityTotalStars: 0,
  communityPoolUsdt: 0.0,
  estimatedValuePerStar: 0.0,
  userWeeklyStars: 0,
  userTotalStars: 0,
  userEstimatedShareUsdt: 0.0,
  userUsdtBalance: 0.0,
  adsWatchedToday: 0,
  dailyCap: 20,
  cooldownSecondsRemaining: 0,
  minWithdrawalUsdt: 10.00,
  payoutWallet: ''
};

let adTimerInterval = null;
let adWatchRemaining = 15;
let currentCooldown = 0;
let cooldownInterval = null;

function updateCountdownClocks() {
  const nowSec = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, (poolData.endsAt || (nowSec + 345600)) - nowSec);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  const seconds = diff % 60;
  const timeStr = `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;

  if ($('pool-countdown')) $('pool-countdown').textContent = timeStr;
  if ($('home-pool-countdown')) $('home-pool-countdown').textContent = `${days}d ${hours}h`;
}

async function refreshPoolData() {
  if (online) {
    try {
      const res = await api('/ads/pool');
      poolData = { ...poolData, ...res };
      player.stars = res.userTotalStars;
      player.weeklyStars = res.userWeeklyStars;
      player.usdtBalance = res.userUsdtBalance;
      if (res.payoutWallet && !player.payoutWallet) player.payoutWallet = res.payoutWallet;
      currentCooldown = res.cooldownSecondsRemaining || 0;
    } catch (err) {
      console.warn('Failed to refresh pool data:', err);
    }
  } else {
    const guestStars = Number(player.stars || 0);
    const guestWeekly = Number(player.weeklyStars || 0);
    const guestBalance = Number(player.usdtBalance || 0);
    poolData.communityTotalStars = 0;
    poolData.communityPoolUsdt = 0.0;
    poolData.estimatedValuePerStar = 0.0;
    poolData.userWeeklyStars = guestWeekly;
    poolData.userTotalStars = guestStars;
    poolData.userEstimatedShareUsdt = 0.0;
    poolData.userUsdtBalance = guestBalance;
  }

  if ($('top-stars')) $('top-stars').textContent = num(player.stars || 0);
  if ($('top-usdt')) $('top-usdt').textContent = `$${Number(player.usdtBalance || 0).toFixed(2)}`;
  if ($('home-pool-usdt')) $('home-pool-usdt').textContent = `$${Number(poolData.communityPoolUsdt || 0).toFixed(2)}`;

  if ($('pool-community-usdt')) $('pool-community-usdt').textContent = `$${Number(poolData.communityPoolUsdt || 0).toFixed(2)}`;
  if ($('pool-community-stars')) $('pool-community-stars').textContent = num(poolData.communityTotalStars || 0);
  if ($('pool-star-value')) $('pool-star-value').textContent = `$${Number(poolData.estimatedValuePerStar || 0).toFixed(4)}`;

  if ($('pool-user-weekly-stars')) $('pool-user-weekly-stars').textContent = num(player.weeklyStars || 0);
  if ($('pool-user-share-usdt')) $('pool-user-share-usdt').textContent = `$${Number(poolData.userEstimatedShareUsdt || (player.weeklyStars * poolData.estimatedValuePerStar) || 0).toFixed(2)}`;
  if ($('pool-user-total-stars')) $('pool-user-total-stars').textContent = num(player.stars || 0);

  if ($('wallet-usdt-balance')) $('wallet-usdt-balance').textContent = `$${Number(player.usdtBalance || 0).toFixed(2)}`;
  if ($('quick-all-val')) $('quick-all-val').textContent = Number(player.usdtBalance || 0).toFixed(2);
  if ($('profile-total-stars')) $('profile-total-stars').textContent = num(player.stars || 0);
  if ($('profile-total-earned')) $('profile-total-earned').textContent = `$${Number(player.usdtBalance || 0).toFixed(2)}`;
  if ($('pool-daily-count')) $('pool-daily-count').textContent = `${poolData.adsWatchedToday || 0} / 20 ads watched today`;

  if ($('wallet-address-input') && !$('wallet-address-input').value && (poolData.payoutWallet || player.payoutWallet)) {
    $('wallet-address-input').value = poolData.payoutWallet || player.payoutWallet;
  }

  // Render past Friday settlements
  const pastList = $('past-settlements-list');
  if (pastList && poolData.pastSettlements && poolData.pastSettlements.length > 0) {
    clear(pastList);
    for (const item of poolData.pastSettlements) {
      const row = el('div', 'past-settlement-item');
      const main = el('div', 'past-settlement-main');
      const badge = el('span', 'past-settlement-badge', 'FRIDAY SETTLED');
      const info = el('div', 'past-settlement-info');
      const dateStr = item.settledAt ? new Date(item.settledAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : item.weekId;
      info.append(
        el('strong', '', `${item.weekId} · ${dateStr}`),
        el('small', '', `${num(item.totalStars)} Stars converted · Pool: $${Number(item.communityPoolUsdt).toFixed(2)} USDT`)
      );
      main.append(badge, info);
      const rate = el('div', 'past-settlement-rate');
      rate.append(
        el('b', '', `$${Number(item.valuePerStar).toFixed(4)}`),
        el('span', '', 'per 1 ⭐ Star')
      );
      row.append(main, rate);
      pastList.append(row);
    }
  }

  const adminCtrls = $('admin-pool-controls');
  if (adminCtrls) adminCtrls.style.display = (player && player.isAdmin) ? 'block' : 'none';

  updateCooldownDisplay();
  updateCountdownClocks();
}

function updateCooldownDisplay() {
  const ready = currentCooldown <= 0 && (poolData.adsWatchedToday < 20);
  const isCapped = poolData.adsWatchedToday >= 20;

  if ($('pool-ad-status-chip')) {
    $('pool-ad-status-chip').textContent = isCapped ? 'DAILY CAP' : (ready ? 'READY' : 'COOLDOWN');
    $('pool-ad-status-chip').className = `soft-chip ${ready ? 'live' : ''}`;
  }

  const cooldownText = isCapped ? '20/20 Daily Limit Reached' : (currentCooldown > 0 ? `Next ad ready in ${currentCooldown}s` : 'Ready to watch');
  if ($('pool-cooldown-text')) $('pool-cooldown-text').textContent = cooldownText;
  if ($('sidebar-cooldown-text')) $('sidebar-cooldown-text').textContent = cooldownText;

  const btnText = isCapped ? 'Daily Limit Reached (20/20)' : (currentCooldown > 0 ? `Cooldown (${currentCooldown}s)` : '▶ Watch Sponsor Ad (+1 ⭐)');
  if ($('pool-watch-ad-btn')) {
    $('pool-watch-ad-btn').disabled = !ready;
    $('pool-watch-ad-btn').textContent = btnText;
  }
  if ($('sidebar-watch-ad-btn')) {
    $('sidebar-watch-ad-btn').disabled = !ready;
    $('sidebar-watch-ad-btn').textContent = isCapped ? 'Daily Cap (20/20)' : (currentCooldown > 0 ? `Wait ${currentCooldown}s` : 'Watch Ad (+1 ⭐)');
  }
}

function startCooldownTimer(seconds = 60) {
  currentCooldown = seconds;
  clearInterval(cooldownInterval);
  updateCooldownDisplay();
  cooldownInterval = setInterval(() => {
    currentCooldown--;
    if (currentCooldown <= 0) {
      currentCooldown = 0;
      clearInterval(cooldownInterval);
    }
    updateCooldownDisplay();
  }, 1000);
}

function openAdPlayer() {
  if (!online) {
    toast('⭐ Real Star rewards are earned inside Telegram. Open the app in Telegram to watch ads!');
    return;
  }
  if (currentCooldown > 0) {
    toast(`Ad cooldown active. Please wait ${currentCooldown} seconds.`);
    return;
  }
  if (poolData.adsWatchedToday >= 20) {
    toast('Daily limit reached (20 ads / 24 hours). Come back tomorrow!');
    return;
  }

  const sponsor = SPONSORS[Math.floor(Math.random() * SPONSORS.length)];
  $('ad-showcase-icon').textContent = sponsor.icon;
  $('ad-showcase-title').textContent = sponsor.title;
  $('ad-showcase-desc').textContent = sponsor.desc;

  adWatchRemaining = 15;
  $('ad-timer-badge').textContent = '15s';
  $('ad-progress-bar').style.width = '0%';
  $('ad-claim-btn').disabled = true;
  $('ad-claim-btn').textContent = 'Watching Sponsor Ad (15s)...';
  $('ad-player-status').textContent = 'Please watch the full 15 seconds to receive your 1 ⭐ Star.';
  $('ad-cancel-btn').style.display = 'block';

  $('ad-player-dialog').showModal();

  const totalDuration = 15;
  const startStamp = Date.now();
  clearInterval(adTimerInterval);

  adTimerInterval = setInterval(() => {
    const elapsed = (Date.now() - startStamp) / 1000;
    const remaining = Math.max(0, totalDuration - elapsed);
    adWatchRemaining = Math.ceil(remaining);

    const progressPercent = Math.min(100, (elapsed / totalDuration) * 100);
    $('ad-progress-bar').style.width = `${progressPercent}%`;
    $('ad-timer-badge').textContent = `${adWatchRemaining}s`;

    if (remaining <= 0) {
      clearInterval(adTimerInterval);
      $('ad-progress-bar').style.width = '100%';
      $('ad-timer-badge').textContent = 'DONE ✓';
      $('ad-claim-btn').disabled = false;
      $('ad-claim-btn').textContent = 'Claim 1 ⭐ Star Now!';
      $('ad-player-status').textContent = '🎉 Sponsor showcase finished! Tap below to claim your Star.';
      $('ad-cancel-btn').style.display = 'none';
      try { tg?.HapticFeedback?.notificationOccurred('success'); } catch {}
    }
  }, 100);
}

function closeAdPlayer(rewarded = false) {
  clearInterval(adTimerInterval);
  $('ad-player-dialog').close();
  if (!rewarded && adWatchRemaining > 0) {
    toast('Ad was closed early. 0 Stars awarded.');
  }
}

async function claimAdReward() {
  if ($('ad-claim-btn').disabled) return;
  $('ad-claim-btn').disabled = true;
  $('ad-claim-btn').textContent = 'Verifying reward...';

  try {
    if (online) {
      const res = await api('/ads/claim', { method: 'POST', body: { network: 'direct' } });
      player.stars = res.stars;
      player.weeklyStars = res.weeklyStars;
      poolData.adsWatchedToday = res.adsToday;
      startCooldownTimer(res.cooldownSeconds || 60);
    } else {
      player.stars = (player.stars || 0) + 1;
      player.weeklyStars = (player.weeklyStars || 0) + 1;
      poolData.adsWatchedToday = (poolData.adsWatchedToday || 0) + 1;
      storeGuest();
      startCooldownTimer(60);
    }

    closeAdPlayer(true);
    toast('🎉 Verified! +1 ⭐ Star credited to your weekly revenue share!');
    try { tg?.HapticFeedback?.notificationOccurred('success'); } catch {}
    refreshPoolData();
    renderProfileBase();
  } catch (err) {
    toast(err.message);
    $('ad-claim-btn').disabled = false;
    $('ad-claim-btn').textContent = 'Try Claiming Again';
  }
}

let userWithdrawals = [];

function renderUserWithdrawals() {
  const container = $('user-withdrawals-list');
  if (!container) return;
  clear(container);

  if (!userWithdrawals || userWithdrawals.length === 0) {
    container.append(el('div', 'empty-state', 'No withdrawal requests yet. Payouts and blockchain transaction hashes will appear here.'));
    return;
  }

  for (const item of userWithdrawals) {
    const card = el('div', `withdrawal-card status-${item.status || 'pending'}`);
    
    // Top row: Amount + Status badge
    const topRow = el('div', 'withdrawal-card-top');
    const amountText = item.status === 'rejected'
      ? `+$${Number(item.amount).toFixed(2)} USDT (Refunded)`
      : `-$${Number(item.amount).toFixed(2)} USDT`;
    const amtEl = el('span', 'withdrawal-card-amount', amountText);
    
    let badgeText = '⏳ PENDING MANUAL REVIEW';
    if (item.status === 'completed') badgeText = '✅ COMPLETED';
    else if (item.status === 'rejected') badgeText = '❌ REJECTED';
    const badgeEl = el('span', `withdrawal-status-badge ${item.status || 'pending'}`, badgeText);
    topRow.append(amtEl, badgeEl);

    // Details: Address + Network
    const details = el('div', 'withdrawal-card-details');
    const addrRow = el('div');
    const shortAddr = item.address ? `${item.address.slice(0, 10)}...${item.address.slice(-8)}` : 'BEP-20 Wallet';
    addrRow.innerHTML = `<span>Network: <b>${item.network || 'BEP-20'}</b> · To: <code>${shortAddr}</code></span>`;
    details.append(addrRow);

    // Meta row: Date + BscScan link if completed
    const metaRow = el('div', 'withdrawal-card-meta');
    const dateStr = item.requestedAt ? new Date(item.requestedAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Recently';
    metaRow.append(el('span', '', `${dateStr} UTC`));

    if (item.status === 'completed' && item.txHash) {
      const bscLink = el('a', 'bsc-link', 'View on BscScan ↗');
      bscLink.href = `https://bscscan.com/tx/${item.txHash}`;
      bscLink.target = '_blank';
      bscLink.rel = 'noopener';
      metaRow.append(bscLink);
    }
    details.append(metaRow);

    // Contextual status note
    if (item.status === 'pending') {
      const note = el('div', 'withdrawal-pending-note', 'ℹ️ Manual transfer in progress. We verify and send USDT on BEP-20. You will receive a Telegram message once confirmed.');
      details.append(note);
    } else if (item.status === 'rejected' && item.rejectionReason) {
      const reasonEl = el('div', 'withdrawal-reason-text', `Reason: ${item.rejectionReason}`);
      details.append(reasonEl);
    }

    card.append(topRow, details);
    container.append(card);
  }
}

async function refreshUserWithdrawals() {
  if (online) {
    try {
      const res = await api('/wallet/history');
      userWithdrawals = res.requests || [];
    } catch (err) {
      console.warn('Failed to load withdrawal history:', err);
    }
  } else {
    userWithdrawals = read('ms_demo_withdrawals', []);
  }
  renderUserWithdrawals();
}

async function submitWithdrawal() {
  const network = $('wallet-network-select')?.value || 'BEP-20';
  const address = ($('wallet-address-input')?.value || '').trim();
  const amount = Number($('wallet-amount-input')?.value);

  const statusMsg = $('wallet-status-msg');
  if (statusMsg) {
    statusMsg.hidden = true;
    statusMsg.className = 'pool-status-msg';
  }

  if (network === 'BEP-20' && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    toast('Please enter a valid BEP-20 address starting with 0x (42 characters).');
    $('wallet-address-input')?.focus();
    return;
  } else if (!address || address.length < 10) {
    toast('Please enter a valid destination wallet address.');
    $('wallet-address-input')?.focus();
    return;
  }
  if (isNaN(amount) || amount < 10.00) {
    toast('Minimum withdrawal amount is $10.00 USDT.');
    $('wallet-amount-input')?.focus();
    return;
  }
  if (amount > (player.usdtBalance || 0)) {
    toast(`Insufficient balance. You have $${Number(player.usdtBalance || 0).toFixed(2)} USDT.`);
    return;
  }

  const refCount = Number(player.referralsCount || 0);
  const hasWithdrawn = Boolean(player.hasWithdrawn);
  if (!hasWithdrawn && refCount < 10) {
    toast(`🔒 Withdrawal locked. You need at least 10 referrals for your 1st withdrawal (Current: ${refCount}/10).`);
    return;
  }

  const withdrawBtn = $('wallet-withdraw-btn');
  if (withdrawBtn) {
    withdrawBtn.disabled = true;
    withdrawBtn.textContent = 'Submitting Request...';
  }

  try {
    if (online) {
      const res = await api('/wallet/withdraw', {
        method: 'POST',
        body: { network, address, amount }
      });
      player.usdtBalance = res.remainingBalance;
      player.payoutWallet = address;
      player.hasWithdrawn = true;
      player.canWithdraw = true;
      await refreshUserWithdrawals();
    } else {
      player.usdtBalance = Math.max(0, (player.usdtBalance || 0) - amount);
      player.payoutWallet = address;
      player.hasWithdrawn = true;
      player.canWithdraw = true;
      const guestWd = {
        id: `wd_guest_${stamp()}`,
        amount,
        network,
        address,
        status: 'pending',
        requestedAt: stamp(),
        processedAt: null,
        txHash: null,
        rejectionReason: null
      };
      userWithdrawals = [guestWd, ...read('ms_demo_withdrawals', [])];
      write('ms_demo_withdrawals', userWithdrawals);
      storeGuest();
      renderUserWithdrawals();
    }

    if (statusMsg) {
      statusMsg.hidden = false;
      statusMsg.className = 'pool-status-msg success';
      statusMsg.textContent = `⏳ Payout request of $${amount.toFixed(2)} USDT received! Status: Pending manual review. You will receive a Telegram message once the BEP-20 transfer completes.`;
    }
    toast(`⏳ Withdrawal request for $${amount.toFixed(2)} USDT received! Status: Pending manual transfer.`);
    if ($('wallet-amount-input')) $('wallet-amount-input').value = '';

    refreshPoolData();
    renderProfileBase();
  } catch (err) {
    if (statusMsg) {
      statusMsg.hidden = false;
      statusMsg.className = 'pool-status-msg error';
      statusMsg.textContent = `Failed: ${err.message}`;
    }
    toast(err.message);
  } finally {
    if (withdrawBtn) {
      withdrawBtn.disabled = false;
      withdrawBtn.textContent = 'Request USDT Withdrawal ↗';
    }
  }
}

// ============================================================================
// ADMIN CONSOLE: MANUAL SETTLEMENT CONFIRMATION
// ============================================================================

let adminSummary = {
  weekId: '',
  totalStars: 0,
  totalRevenueUsdt: 0,
  communityPoolUsdt: 0,
  eligiblePlayers: 0,
  currentRatio: 0
};

async function openAdminSettleDialog() {
  const dialog = $('admin-settle-dialog');
  if (!dialog) return;

  const statusMsg = $('admin-settle-status');
  if (statusMsg) statusMsg.hidden = true;
  if ($('admin-confirm-checkbox')) $('admin-confirm-checkbox').checked = false;
  if ($('admin-execute-settle-btn')) $('admin-execute-settle-btn').disabled = true;

  if (online) {
    try {
      const summary = await api('/admin/pool-summary');
      adminSummary = summary;
    } catch (err) {
      console.warn('Failed to fetch admin pool summary:', err);
      adminSummary = {
        weekId: poolData.weekId || 'Current Round',
        totalStars: poolData.communityTotalStars || 0,
        totalRevenueUsdt: (poolData.communityPoolUsdt || 0) * 2,
        communityPoolUsdt: poolData.communityPoolUsdt || 0,
        eligiblePlayers: 1,
        currentRatio: poolData.estimatedValuePerStar || 0
      };
    }
  } else {
    adminSummary = {
      weekId: poolData.weekId || '2026-W46',
      totalStars: 0,
      totalRevenueUsdt: 0.0,
      communityPoolUsdt: 0.0,
      eligiblePlayers: 0,
      currentRatio: 0.0
    };
  }

  if ($('admin-pool-weekid')) $('admin-pool-weekid').textContent = adminSummary.weekId;
  if ($('admin-pool-total-stars')) $('admin-pool-total-stars').textContent = num(adminSummary.totalStars);
  if ($('admin-pool-eligible-players')) $('admin-pool-eligible-players').textContent = num(adminSummary.eligiblePlayers);

  const estRev = Number(adminSummary.totalRevenueUsdt || 0);
  const estRate = Number(adminSummary.currentRatio || 0);
  if ($('admin-settle-rev-input')) $('admin-settle-rev-input').value = estRev > 0 ? estRev.toFixed(2) : '';
  if ($('admin-settle-rate-input')) $('admin-settle-rate-input').value = estRate > 0 ? estRate.toFixed(4) : '';

  updateAdminCalculatedPreview();
  dialog.showModal();
}

function updateAdminCalculatedPreview() {
  const revInput = $('admin-settle-rev-input');
  const rateInput = $('admin-settle-rate-input');
  const preview = $('admin-calculated-ratio');
  const confirmCb = $('admin-confirm-checkbox');
  const execBtn = $('admin-execute-settle-btn');

  const totalStars = adminSummary.totalStars || 0;
  const rev = Number(revInput?.value || 0);
  const rate = Number(rateInput?.value || 0);

  let finalRate = 0;
  let finalPool = 0;

  if (rate > 0) {
    finalRate = rate;
    finalPool = totalStars * rate;
  } else if (rev > 0) {
    finalPool = rev * 0.50;
    finalRate = totalStars > 0 ? (finalPool / totalStars) : 0;
  }

  if (preview) {
    preview.textContent = `1 ⭐ = $${finalRate.toFixed(4)} USDT (Pool: $${finalPool.toFixed(2)} USDT)`;
  }

  if (execBtn) {
    const isReady = (finalRate > 0 || totalStars === 0) && confirmCb?.checked;
    execBtn.disabled = !isReady;
  }
}

async function executeAdminSettlement() {
  const btn = $('admin-execute-settle-btn');
  const statusMsg = $('admin-settle-status');
  const revInput = $('admin-settle-rev-input');
  const rateInput = $('admin-settle-rate-input');

  const adRevenueUsdt = revInput?.value ? Number(revInput.value) : undefined;
  const valuePerStar = rateInput?.value ? Number(rateInput.value) : undefined;

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Processing Settlement...';
    }

    if (online) {
      const res = await api('/admin/settle-week', {
        method: 'POST',
        body: {
          weekId: adminSummary.weekId,
          adRevenueUsdt,
          valuePerStar
        }
      });
      if (statusMsg) {
        statusMsg.hidden = false;
        statusMsg.className = 'pool-status-msg success';
        statusMsg.textContent = `✅ Confirmed! Converted ${num(res.totalStars)} Stars at $${Number(res.valuePerStar).toFixed(4)} USDT/Star.`;
      }
      toast('✅ Settlement Confirmed! Converted to USDT.');
      await refreshPoolData();
      try {
        const updated = await api('/me');
        if (updated?.player) player = { ...player, ...updated.player };
        renderProfileBase();
      } catch {}
    } else {
      const rate = valuePerStar || (adRevenueUsdt ? (adRevenueUsdt * 0.5) / (adminSummary.totalStars || 1) : 0.01);
      const earned = (player.weeklyStars || 0) * rate;
      player.usdtBalance = (player.usdtBalance || 0) + earned;
      player.weeklyStars = 0;
      storeGuest();
      if (statusMsg) {
        statusMsg.hidden = false;
        statusMsg.className = 'pool-status-msg success';
        statusMsg.textContent = `✅ Demo Settled! Converted weekly stars to +$${earned.toFixed(2)} USDT.`;
      }
      toast('✅ Demo Settlement Confirmed!');
      refreshPoolData();
      renderProfileBase();
    }

    setTimeout(() => {
      $('admin-settle-dialog')?.close();
    }, 2200);
  } catch (err) {
    if (statusMsg) {
      statusMsg.hidden = false;
      statusMsg.className = 'pool-status-msg error';
      statusMsg.textContent = `Settlement failed: ${err.message}`;
    }
    toast(`Settlement failed: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Confirm & Convert Stars Now';
    }
  }
}

async function boot() {
  try { tg?.ready?.(); tg?.expand?.(); } catch {}
  $('today-label').textContent = new Date().toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  if (!(await authenticate())) {
    player = { ...emptyPlayer(), ...read('ms_demo_player_v2', {}) };
    player.stars = 0;
    player.weeklyStars = 0;
    player.usdtBalance = 0.0;
    recentGames = read('ms_demo_recent', []);
    daily = read('ms_demo_daily', daily);
    refreshGuestDaily();
    player.streak = localStreak();
    applyTheme(player.equippedTheme);
    storeGuest();
  }

  const urlParamGame = new URLSearchParams(window.location.search).get('game');
  const urlParamMode = new URLSearchParams(window.location.search).get('mode');
  const urlParamView = new URLSearchParams(window.location.search).get('view');

  // Hydrate Merge Streak run
  const activeMerge = online ? activeRuns.find(run => run.mode === 'classic' && (run.gameType === 'merge' || !run.gameType)) : read('ms_demo_run_classic');
  if (activeMerge) {
    const cache = online ? read(`ms_run_${player.id}_${activeMerge.id}`, {}) : activeMerge;
    hydrateRun(activeMerge, cache.moves || []);
  } else if (!online) {
    const run = { id: 'guest-classic', mode: 'classic', game: 'merge', seed: localSeed(), startedAt: stamp() };
    hydrateRun(run, []);
  } else {
    currentMode = 'classic';
    setStatus('Choose Play classic to begin your first run.');
  }

  // Hydrate Block Collapse run
  const activeBlocks = online ? activeRuns.find(run => run.gameType === 'blocks') : read('ms_demo_blocks_run');
  if (activeBlocks) {
    const cache = online ? read(`ms_blocks_run_${player.id}_${activeBlocks.id}`, {}) : activeBlocks;
    hydrateBlocksRun(activeBlocks, cache.moves || []);
  } else if (!online) {
    const run = { id: `guest-blocks-${stamp()}`, mode: 'classic', game: 'blocks', seed: localSeed(), startedAt: stamp() };
    hydrateBlocksRun(run, []);
  }

  // Hydrate Color Cascade run
  const activeCascade = online ? activeRuns.find(run => run.gameType === 'cascade') : read('ms_demo_cascade_run');
  if (activeCascade) {
    const cache = online ? read(`ms_cascade_run_${player.id}_${activeCascade.id}`, {}) : activeCascade;
    hydrateCascadeRun(activeCascade, cache.moves || []);
  } else if (!online) {
    const run = { id: `guest-cascade-${stamp()}`, mode: 'classic', game: 'cascade', seed: localSeed(), startedAt: stamp() };
    hydrateCascadeRun(run, []);
  }

  // Hydrate Memory Matrix run
  const activeMemory = online ? activeRuns.find(run => run.gameType === 'memory') : read('ms_demo_memory_run');
  if (activeMemory) {
    const cache = online ? read(`ms_memory_run_${player.id}_${activeMemory.id}`, {}) : activeMemory;
    hydrateMemoryRun(activeMemory, cache.moves || []);
  } else if (!online) {
    const run = { id: `guest-memory-${stamp()}`, mode: 'classic', game: 'memory', seed: localSeed(), startedAt: stamp() };
    hydrateMemoryRun(run, []);
  }

  // Hydrate Neon Viper run
  const activeViper = online ? activeRuns.find(run => run.gameType === 'viper') : read('ms_demo_viper_run');
  if (activeViper) {
    const cache = online ? read(`ms_viper_run_${player.id}_${activeViper.id}`, {}) : activeViper;
    hydrateViperRun(activeViper, cache.moves || []);
  } else if (!online) {
    const run = { id: `guest-viper-${stamp()}`, mode: 'classic', game: 'viper', seed: localSeed(), startedAt: stamp() };
    hydrateViperRun(run, []);
  }

  renderDashboard();
  renderShop();
  refreshLeaderboard();
  refreshPoolData();
  setInterval(updateCountdownClocks, 1000);

  if (urlParamView === 'pool') {
    setView('pool');
  } else if (urlParamMode === 'daily') {
    switchGame('merge');
    launch('daily', false);
    setView('play');
  } else if (urlParamGame === 'viper') {
    switchGame('viper');
    setView('play');
  } else if (urlParamGame === 'memory') {
    switchGame('memory');
    setView('play');
  } else if (urlParamGame === 'cascade') {
    switchGame('cascade');
    setView('play');
  } else if (urlParamGame === 'blocks') {
    switchGame('blocks');
    setView('play');
  } else if (urlParamGame === 'merge') {
    switchGame('merge');
    setView('play');
  } else {
    setView('home');
  }
}

// UI routing & Event Listeners
for (const button of document.querySelectorAll('[data-view-target]')) {
  button.addEventListener('click', () => setView(button.dataset.viewTarget));
}
$('pool-watch-ad-btn')?.addEventListener('click', openAdPlayer);
$('sidebar-watch-ad-btn')?.addEventListener('click', openAdPlayer);
$('ad-claim-btn')?.addEventListener('click', claimAdReward);
$('ad-cancel-btn')?.addEventListener('click', () => closeAdPlayer(false));
$('wallet-withdraw-btn')?.addEventListener('click', submitWithdrawal);
$('wallet-withdraw-form')?.addEventListener('submit', (e) => { e.preventDefault(); submitWithdrawal(); });
$('refresh-withdrawals-btn')?.addEventListener('click', refreshUserWithdrawals);

// Referral Link Share & Copy Listeners
$('copy-ref-link-btn')?.addEventListener('click', () => {
  const input = $('profile-ref-link-input');
  if (!input) return;
  input.select();
  navigator.clipboard?.writeText(input.value).then(() => {
    toast('📋 Referral link copied to clipboard!');
  }).catch(() => {
    document.execCommand('copy');
    toast('📋 Referral link copied!');
  });
});

$('share-ref-link-btn')?.addEventListener('click', () => {
  const input = $('profile-ref-link-input');
  const link = input?.value || 'https://t.me/mergestakeearn_bot';
  const text = '🎮 Play Merge Streak Arcade with me! 5 exciting games, earn Stars, and share in 50% weekly ad revenue pool in USDT!';
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  try {
    if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
    else window.open(shareUrl, '_blank');
  } catch {
    window.open(shareUrl, '_blank');
  }
});

// Admin Settlement Console Listeners
$('open-admin-settle-btn')?.addEventListener('click', openAdminSettleDialog);
$('admin-settle-rev-input')?.addEventListener('input', (e) => {
  const rev = Number(e.target.value || 0);
  const totalStars = adminSummary.totalStars || 0;
  if (rev > 0 && $('admin-settle-rate-input')) {
    const rate = totalStars > 0 ? (rev * 0.50) / totalStars : 0;
    $('admin-settle-rate-input').value = rate.toFixed(4);
  }
  updateAdminCalculatedPreview();
});
$('admin-settle-rate-input')?.addEventListener('input', (e) => {
  const rate = Number(e.target.value || 0);
  const totalStars = adminSummary.totalStars || 0;
  if (rate > 0 && $('admin-settle-rev-input')) {
    const rev = (rate * totalStars) * 2;
    $('admin-settle-rev-input').value = rev.toFixed(2);
  }
  updateAdminCalculatedPreview();
});
$('admin-confirm-checkbox')?.addEventListener('change', updateAdminCalculatedPreview);
$('admin-execute-settle-btn')?.addEventListener('click', executeAdminSettlement);

$('quick-withdraw-all-btn')?.addEventListener('click', () => {
  if ($('wallet-amount-input')) $('wallet-amount-input').value = Math.max(10, Number(player.usdtBalance || 0)).toFixed(2);
});
$('quick-withdraw-10-btn')?.addEventListener('click', () => {
  if ($('wallet-amount-input')) $('wallet-amount-input').value = '10.00';
});
$('quick-withdraw-25-btn')?.addEventListener('click', () => {
  if ($('wallet-amount-input')) $('wallet-amount-input').value = '25.00';
});
$('quick-withdraw-50-btn')?.addEventListener('click', () => {
  if ($('wallet-amount-input')) $('wallet-amount-input').value = '50.00';
});
$('quick-withdraw-100-btn')?.addEventListener('click', () => {
  if ($('wallet-amount-input')) $('wallet-amount-input').value = '100.00';
});
for (const button of document.querySelectorAll('[data-switch-game]')) {
  button.addEventListener('click', () => switchGame(button.dataset.switchGame));
}
for (const button of document.querySelectorAll('[data-launch-game]')) {
  button.addEventListener('click', () => {
    const g = button.dataset.launchGame;
    const m = button.dataset.launchMode || 'classic';
    if (g === 'viper') {
      launchViper(false);
    } else if (g === 'memory') {
      launchMemory(false);
    } else if (g === 'cascade') {
      launchCascade(false);
    } else if (g === 'blocks') {
      launchBlocks(false);
    } else {
      launch(m, false);
    }
  });
}
for (const button of document.querySelectorAll('[data-launch-mode]')) {
  button.addEventListener('click', () => {
    switchGame('merge');
    launch(button.dataset.launchMode);
  });
}
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => launch(button.dataset.mode));
}
for (const button of document.querySelectorAll('[data-rank-mode]')) {
  button.addEventListener('click', () => {
    rankMode = button.dataset.rankMode;
    document.querySelectorAll('[data-rank-mode]').forEach(b => b.classList.toggle('active', b.dataset.rankMode === rankMode));
    refreshLeaderboard();
  });
}
for (const button of document.querySelectorAll('[data-rank-game]')) {
  button.addEventListener('click', () => {
    rankGame = button.dataset.rankGame;
    document.querySelectorAll('[data-rank-game]').forEach(b => b.classList.toggle('active', b.dataset.rankGame === rankGame));
    refreshLeaderboard();
  });
}
for (const button of document.querySelectorAll('[data-direction]')) {
  button.addEventListener('click', () => takeTurn(button.dataset.direction));
}
for (const button of document.querySelectorAll('[data-viper-dir]')) {
  button.addEventListener('click', () => setViperDirection(button.dataset.viperDir));
}

$('new-game-btn').addEventListener('click', () => launch(currentMode, true));
$('bank-btn').addEventListener('click', () => {
  if (currentMode === 'daily' && !confirm('Save your daily score now? This ends your only daily attempt.')) return;
  completeGame();
});

$('blocks-new-game-btn').addEventListener('click', () => launchBlocks(true));
$('blocks-bank-btn').addEventListener('click', () => completeBlocksGame());

$('cascade-new-game-btn').addEventListener('click', () => launchCascade(true));
$('cascade-bank-btn').addEventListener('click', () => completeCascadeGame());

$('memory-new-game-btn').addEventListener('click', () => launchMemory(true));
$('memory-bank-btn').addEventListener('click', () => completeMemoryGame());

$('viper-new-game-btn').addEventListener('click', () => launchViper(true));
$('viper-bank-btn').addEventListener('click', () => completeViperGame());

$('help-btn').addEventListener('click', () => $('info-dialog').showModal());
$('refresh-leaders').addEventListener('click', refreshLeaderboard);
$('dismiss-finish-btn').addEventListener('click', () => { $('finish-dialog').close(); setView('home'); });
$('play-again-btn').addEventListener('click', () => {
  $('finish-dialog').close();
  if (lastFinishedGameType === 'viper') {
    switchGame('viper');
    launchViper(true);
  } else if (lastFinishedGameType === 'memory') {
    switchGame('memory');
    launchMemory(true);
  } else if (lastFinishedGameType === 'cascade') {
    switchGame('cascade');
    launchCascade(true);
  } else if (lastFinishedGameType === 'blocks') {
    switchGame('blocks');
    launchBlocks(true);
  } else {
    const mode = currentMode === 'daily' ? 'classic' : currentMode;
    switchGame('merge');
    launch(mode, true);
  }
});

let swipe = null; const board = $('game-board');
board.addEventListener('pointerdown', e => { swipe = { x: e.clientX, y: e.clientY }; });
board.addEventListener('pointerup', e => {
  if (!swipe) return; const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
  takeTurn(Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
});
board.addEventListener('pointercancel', () => swipe = null);

let viperSwipe = null; const vCanvas = $('viper-canvas');
vCanvas?.addEventListener('pointerdown', e => { viperSwipe = { x: e.clientX, y: e.clientY }; });
vCanvas?.addEventListener('pointerup', e => {
  if (!viperSwipe) return; const dx = e.clientX - viperSwipe.x, dy = e.clientY - viperSwipe.y; viperSwipe = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 15) return;
  setViperDirection(Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
});
vCanvas?.addEventListener('pointercancel', () => viperSwipe = null);

document.addEventListener('keydown', e => {
  if ($('info-dialog').open || $('finish-dialog').open || view !== 'play') return;
  if (activeGame === 'merge') {
    const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }[e.key];
    if (direction) { e.preventDefault(); takeTurn(direction); }
  } else if (activeGame === 'viper') {
    const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }[e.key];
    if (direction) { e.preventDefault(); setViperDirection(direction); }
  }
});

boot();
