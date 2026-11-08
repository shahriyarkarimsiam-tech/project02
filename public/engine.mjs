/** Merge Streak deterministic 4x4 puzzle engine. No DOM or network dependencies. */
export const SIZE = 4;
export const DIRECTIONS = Object.freeze(['left', 'right', 'up', 'down']);

function nextRandom(state) {
  // xorshift32: deterministic spawning for trustworthy server-side replays.
  let x = state.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 4294967296;
}

function spawn(state) {
  const empty = [];
  state.board.forEach((tile, index) => { if (tile === 0) empty.push(index); });
  if (!empty.length) return;
  const index = empty[Math.floor(nextRandom(state) * empty.length)];
  state.board[index] = nextRandom(state) < 0.10 ? 4 : 2;
}

export function hasMoves(board) {
  if (board.includes(0)) return true;
  for (let row = 0; row < SIZE; row++) for (let col = 0; col < SIZE; col++) {
    const value = board[row * SIZE + col];
    if (col < SIZE - 1 && value === board[row * SIZE + col + 1]) return true;
    if (row < SIZE - 1 && value === board[(row + 1) * SIZE + col]) return true;
  }
  return false;
}

export function newGame(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid game seed');
  const state = { board: Array(SIZE * SIZE).fill(0), score: 0, moves: 0, rng: (seed >>> 0) || 0x6d2b79f5, over: false };
  spawn(state);
  spawn(state);
  return state;
}

function indexes(direction, line) {
  return Array.from({ length: SIZE }, (_, i) => {
    switch (direction) {
      case 'left': return line * SIZE + i;
      case 'right': return line * SIZE + (SIZE - 1 - i);
      case 'up': return i * SIZE + line;
      case 'down': return (SIZE - 1 - i) * SIZE + line;
      default: throw new Error('Invalid direction');
    }
  });
}

/** Does not mutate the original state. Invalid/no-op moves do not count. */
export function move(state, direction) {
  if (!DIRECTIONS.includes(direction)) throw new Error('Invalid move');
  if (state.over) return { state, changed: false, gained: 0 };
  const next = { ...state, board: [...state.board] };
  let gained = 0;
  let changed = false;
  for (let line = 0; line < SIZE; line++) {
    const ids = indexes(direction, line);
    const packed = ids.map(i => next.board[i]).filter(Boolean);
    const result = [];
    for (let k = 0; k < packed.length; k++) {
      if (k + 1 < packed.length && packed[k] === packed[k + 1]) {
        const merged = packed[k] * 2;
        gained += merged;
        result.push(merged);
        k++;
      } else result.push(packed[k]);
    }
    while (result.length < SIZE) result.push(0);
    ids.forEach((id, i) => {
      if (next.board[id] !== result[i]) changed = true;
      next.board[id] = result[i];
    });
  }
  if (!changed) return { state, changed: false, gained: 0 };
  next.score += gained;
  next.moves += 1;
  spawn(next);
  next.over = !hasMoves(next.board);
  return { state: next, changed: true, gained };
}

/** Throws if a claimed history has no-op moves or an invalid instruction. */
export function replay(seed, history) {
  if (!Array.isArray(history) || history.length > 1500) throw new Error('Invalid move history');
  let state = newGame(seed);
  for (const direction of history) {
    const result = move(state, direction);
    if (!result.changed) throw new Error('History contains an ineffective move');
    state = result.state;
  }
  return state;
}

export function coinsForScore(score) {
  if (!Number.isFinite(score) || score < 0) throw new Error('Invalid score');
  return Math.min(40, Math.floor(score / 128));
}
