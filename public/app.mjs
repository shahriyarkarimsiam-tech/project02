import { newGame, move, replay, coinsForScore } from './engine.mjs';
import { newBlocksGame, canPlace, placeBlock, replayBlocks, coinsForBlocksScore, GRID_SIZE } from './blocks-engine.mjs';
import { newColorGame, swapGems, replayColors, coinsForColorsScore, GEMS, BOARD_SIZE, MAX_MOVES } from './color-engine.mjs';
import { newMemoryGame, tapPad, replayMemory, coinsForMemoryScore, PADS, NUM_PADS, MAX_LIVES } from './memory-engine.mjs';
import { THEMES, earnedBadges } from './catalog.mjs';

const $ = id => document.getElementById(id);
const tg = window.Telegram?.WebApp;
const dateUTC = () => new Date().toISOString().slice(0, 10);
const stamp = () => Math.floor(Date.now() / 1000);
const num = n => Number(n || 0).toLocaleString('en-US');
const names = { home: 'Overview', play: 'Play game', challenges: 'Challenges', rankings: 'Rankings', shop: 'Theme shop', profile: 'My profile' };
const ranks = [{ at: 0, title: 'Rookie explorer' }, { at: 1, title: 'Bronze merger' }, { at: 5, title: 'Silver strategist' }, { at: 15, title: 'Golden master' }, { at: 40, title: 'Diamond legend' }];
const emptyPlayer = () => ({ id: 'demo', name: 'Guest player', coins: 0, bestScore: 0, bestTile: 0, bestBlocksScore: 0, bestCascadeScore: 0, bestMemoryScore: 0, gamesPlayed: 0, streak: 0, equippedTheme: 'mint', ownedThemes: ['mint'] });

let player = emptyPlayer(), online = false, view = 'home';
let activeGame = 'merge'; // 'merge' | 'blocks' | 'cascade' | 'memory'
let rankGame = 'merge';   // 'merge' | 'blocks' | 'cascade' | 'memory'
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
  document.querySelectorAll('[data-view]').forEach(node => node.classList.toggle('active', node.dataset.view === next));
  document.querySelectorAll('[data-view-target]').forEach(node => {
    node.classList.toggle('active', node.dataset.viewTarget === next);
    if (node.classList.contains('nav-button')) node.setAttribute('aria-current', node.dataset.viewTarget === next ? 'page' : 'false');
  });
  $('page-crumb').textContent = names[next];
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
  $('home-streak').textContent = num(player.streak);

  $('best-score').textContent = num(Math.max(player.bestScore, state?.score || 0));
  $('blocks-best').textContent = num(Math.max(player.bestBlocksScore || 0, blocksState?.score || 0));
  $('cascade-best').textContent = num(Math.max(player.bestCascadeScore || 0, cascadeState?.score || 0));
  $('memory-best').textContent = num(Math.max(player.bestMemoryScore || 0, memoryState?.score || 0));

  $('profile-best').textContent = num(player.bestScore);
  $('profile-blocks-best').textContent = num(player.bestBlocksScore || 0);
  $('profile-cascade-best').textContent = num(player.bestCascadeScore || 0);
  $('profile-memory-best').textContent = num(player.bestMemoryScore || 0);
  $('profile-streak').textContent = num(player.streak);

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
    const isDaily = game.mode === 'daily';
    const row = el('div', 'recent-item');
    const icon = el('span', 'recent-icon', isMemory ? '🧠' : isCascade ? '🔮' : isBlocks ? '🧱' : isDaily ? '⚡' : '🔢');
    const detail = el('div');
    const label = el('strong', '', isMemory ? 'Memory Matrix' : isCascade ? 'Color Cascade' : isBlocks ? 'Block Collapse' : isDaily ? 'Daily challenge' : 'Merge Streak');
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
// GAME SWITCHING & LEADERBOARDS
// ==========================================

function switchGame(gameType) {
  activeGame = gameType === 'blocks' ? 'blocks' : gameType === 'cascade' ? 'cascade' : gameType === 'memory' ? 'memory' : 'merge';
  document.querySelectorAll('[data-switch-game]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.switchGame === activeGame);
  });
  $('merge-game-view').style.display = activeGame === 'merge' ? 'block' : 'none';
  $('blocks-game-view').style.display = activeGame === 'blocks' ? 'block' : 'none';
  $('cascade-game-view').style.display = activeGame === 'cascade' ? 'block' : 'none';
  $('memory-game-view').style.display = activeGame === 'memory' ? 'block' : 'none';

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
  const gameName = rankGame === 'blocks' ? 'Block Collapse' : rankGame === 'cascade' ? 'Color Cascade' : rankGame === 'memory' ? 'Memory Matrix' : 'Merge Streak';
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

async function boot() {
  try { tg?.ready?.(); tg?.expand?.(); } catch {}
  $('today-label').textContent = new Date().toLocaleDateString('en-GB', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  if (!(await authenticate())) {
    player = { ...emptyPlayer(), ...read('ms_demo_player_v2', {}) };
    recentGames = read('ms_demo_recent', []);
    daily = read('ms_demo_daily', daily);
    refreshGuestDaily();
    player.streak = localStreak();
    applyTheme(player.equippedTheme);
  }

  const urlParamGame = new URLSearchParams(window.location.search).get('game');

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

  renderDashboard();
  renderShop();
  refreshLeaderboard();

  if (urlParamGame === 'memory') {
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
for (const button of document.querySelectorAll('[data-switch-game]')) {
  button.addEventListener('click', () => switchGame(button.dataset.switchGame));
}
for (const button of document.querySelectorAll('[data-launch-game]')) {
  button.addEventListener('click', () => {
    const g = button.dataset.launchGame;
    const m = button.dataset.launchMode || 'classic';
    if (g === 'memory') {
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

$('help-btn').addEventListener('click', () => $('info-dialog').showModal());
$('refresh-leaders').addEventListener('click', refreshLeaderboard);
$('dismiss-finish-btn').addEventListener('click', () => { $('finish-dialog').close(); setView('home'); });
$('play-again-btn').addEventListener('click', () => {
  $('finish-dialog').close();
  if (lastFinishedGameType === 'memory') {
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

document.addEventListener('keydown', e => {
  if ($('info-dialog').open || $('finish-dialog').open || view !== 'play') return;
  if (activeGame === 'merge') {
    const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }[e.key];
    if (direction) { e.preventDefault(); takeTurn(direction); }
  }
});

boot();
