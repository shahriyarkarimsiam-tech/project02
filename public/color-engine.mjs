/**
 * Color Cascade (Match-3 Gem Swap Arcade) deterministic engine.
 * Pure ES module: no DOM, network, or external dependencies.
 */

export const BOARD_SIZE = 7;
export const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
export const NUM_COLORS = 5;
export const MAX_MOVES = 30;

export const GEMS = Object.freeze([
  { id: 0, name: 'Ruby', symbol: '♦', color: 'red', hex: '#ff4d6d' },
  { id: 1, name: 'Emerald', symbol: '▲', color: 'green', hex: '#2ec4b6' },
  { id: 2, name: 'Sapphire', symbol: '●', color: 'blue', hex: '#4895ef' },
  { id: 3, name: 'Amber', symbol: '★', color: 'gold', hex: '#ffb703' },
  { id: 4, name: 'Amethyst', symbol: '⬟', color: 'purple', hex: '#9d4edd' }
]);

export function nextRandom(state) {
  let x = state.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 4294967296;
}

export function randomGem(state) {
  return Math.floor(nextRandom(state) * NUM_COLORS);
}

/**
 * Finds all matching cells (3 or more consecutive identical gems in any row or column).
 * Returns array of cell indices.
 */
export function findMatches(board) {
  const matched = new Set();

  // Horizontal checks
  for (let r = 0; r < BOARD_SIZE; r++) {
    let matchLen = 1;
    for (let c = 1; c < BOARD_SIZE; c++) {
      const curr = board[r * BOARD_SIZE + c];
      const prev = board[r * BOARD_SIZE + (c - 1)];
      if (curr >= 0 && curr === prev) {
        matchLen++;
      } else {
        if (matchLen >= 3) {
          for (let k = c - matchLen; k < c; k++) matched.add(r * BOARD_SIZE + k);
        }
        matchLen = 1;
      }
    }
    if (matchLen >= 3) {
      for (let k = BOARD_SIZE - matchLen; k < BOARD_SIZE; k++) matched.add(r * BOARD_SIZE + k);
    }
  }

  // Vertical checks
  for (let c = 0; c < BOARD_SIZE; c++) {
    let matchLen = 1;
    for (let r = 1; r < BOARD_SIZE; r++) {
      const curr = board[r * BOARD_SIZE + c];
      const prev = board[(r - 1) * BOARD_SIZE + c];
      if (curr >= 0 && curr === prev) {
        matchLen++;
      } else {
        if (matchLen >= 3) {
          for (let k = r - matchLen; k < r; k++) matched.add(k * BOARD_SIZE + c);
        }
        matchLen = 1;
      }
    }
    if (matchLen >= 3) {
      for (let k = BOARD_SIZE - matchLen; k < BOARD_SIZE; k++) matched.add(k * BOARD_SIZE + c);
    }
  }

  return Array.from(matched);
}

/**
 * Generates an initial 7x7 board with NO starting matches.
 */
export function createStartingBoard(state) {
  const board = Array(TOTAL_CELLS).fill(0);
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const idx = r * BOARD_SIZE + c;
      const forbidden = new Set();
      if (c >= 2 && board[r * BOARD_SIZE + (c - 1)] === board[r * BOARD_SIZE + (c - 2)]) {
        forbidden.add(board[r * BOARD_SIZE + (c - 1)]);
      }
      if (r >= 2 && board[(r - 1) * BOARD_SIZE + c] === board[(r - 2) * BOARD_SIZE + c]) {
        forbidden.add(board[(r - 1) * BOARD_SIZE + c]);
      }
      let choice = randomGem(state);
      while (forbidden.has(choice)) {
        choice = randomGem(state);
      }
      board[idx] = choice;
    }
  }
  return board;
}

export function newColorGame(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid game seed');
  const state = {
    score: 0,
    moves: 0,
    maxMoves: MAX_MOVES,
    streak: 0,
    totalClears: 0,
    rng: (seed >>> 0) || 0x2b3c4d5e,
    board: [],
    over: false
  };
  state.board = createStartingBoard(state);
  return state;
}

export function applyGravityAndRefill(board, rngState) {
  const nextBoard = [...board];
  for (let c = 0; c < BOARD_SIZE; c++) {
    let writeRow = BOARD_SIZE - 1;
    for (let r = BOARD_SIZE - 1; r >= 0; r--) {
      const val = nextBoard[r * BOARD_SIZE + c];
      if (val !== -1) {
        if (writeRow !== r) {
          nextBoard[writeRow * BOARD_SIZE + c] = val;
          nextBoard[r * BOARD_SIZE + c] = -1;
        }
        writeRow--;
      }
    }
    // Refill empty upper cells
    while (writeRow >= 0) {
      nextBoard[writeRow * BOARD_SIZE + c] = randomGem(rngState);
      writeRow--;
    }
  }
  return nextBoard;
}

/**
 * Executes a player swap of gems at (r1, c1) and (r2, c2).
 * Returns { state: nextState, valid: boolean, pointsGained: number, cascades: number }.
 * Does not mutate input state.
 */
export function swapGems(state, r1, c1, r2, c2) {
  if (state.over) return { state, valid: false, pointsGained: 0, cascades: 0 };
  if (!Number.isInteger(r1) || !Number.isInteger(c1) || !Number.isInteger(r2) || !Number.isInteger(c2)) {
    throw new Error('Invalid coordinates');
  }
  if (r1 < 0 || r1 >= BOARD_SIZE || c1 < 0 || c1 >= BOARD_SIZE || r2 < 0 || r2 >= BOARD_SIZE || c2 < 0 || c2 >= BOARD_SIZE) {
    return { state, valid: false, pointsGained: 0, cascades: 0 };
  }
  // Must be directly adjacent (Manhattan distance === 1)
  if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) {
    return { state, valid: false, pointsGained: 0, cascades: 0 };
  }

  const idx1 = r1 * BOARD_SIZE + c1;
  const idx2 = r2 * BOARD_SIZE + c2;

  let currentBoard = [...state.board];
  // Swap
  const tmp = currentBoard[idx1];
  currentBoard[idx1] = currentBoard[idx2];
  currentBoard[idx2] = tmp;

  // Check if initial swap yields any match
  const initialMatches = findMatches(currentBoard);
  if (initialMatches.length === 0) {
    // No match made: invalid swap
    return { state, valid: false, pointsGained: 0, cascades: 0 };
  }

  // Valid swap! Resolve matches and cascades
  const rngState = { rng: state.rng };
  let pointsGained = 0;
  let cascades = 0;
  let totalClearedGems = 0;

  while (true) {
    const matches = findMatches(currentBoard);
    if (matches.length === 0) break;

    cascades += 1;
    totalClearedGems += matches.length;

    // Multiplier increases with cascades: 1x, 2x, 3x, 4x...
    const stepPoints = (matches.length * 10) * cascades;
    pointsGained += stepPoints;

    // Mark matched cells as empty (-1)
    for (const idx of matches) {
      currentBoard[idx] = -1;
    }

    // Drop and refill
    currentBoard = applyGravityAndRefill(currentBoard, rngState);
  }

  const nextMoves = state.moves + 1;
  const isOver = nextMoves >= state.maxMoves;

  const nextState = {
    score: state.score + pointsGained,
    moves: nextMoves,
    maxMoves: state.maxMoves,
    streak: cascades,
    totalClears: state.totalClears + totalClearedGems,
    rng: rngState.rng,
    board: currentBoard,
    over: isOver
  };

  return { state: nextState, valid: true, pointsGained, cascades };
}

export function replayColors(seed, moves) {
  let current = newColorGame(seed);
  for (const m of moves) {
    const { r1, c1, r2, c2 } = m;
    const result = swapGems(current, r1, c1, r2, c2);
    if (!result.valid) throw new Error('Invalid move in color sequence');
    current = result.state;
  }
  return current;
}

export function coinsForColorsScore(score) {
  // Bounded non-withdrawable virtual currency:
  // e.g. 150 points -> 1 coin, max 15 coins per run
  return Math.max(0, Math.min(15, Math.floor(score / 150)));
}
