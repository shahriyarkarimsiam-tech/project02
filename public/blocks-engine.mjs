/**
 * Block Collapse (8x8 Block Grid Puzzle) deterministic engine.
 * Pure ES module: no DOM, network, or external dependencies.
 */

export const GRID_SIZE = 8;
export const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;

export const SHAPES = Object.freeze([
  // 1-cell
  { id: 'dot', name: 'Dot', cells: Object.freeze([[0, 0]]) },
  // 2-cell lines
  { id: 'h2', name: 'Line 2H', cells: Object.freeze([[0, 0], [0, 1]]) },
  { id: 'v2', name: 'Line 2V', cells: Object.freeze([[0, 0], [1, 0]]) },
  // 3-cell lines
  { id: 'h3', name: 'Line 3H', cells: Object.freeze([[0, 0], [0, 1], [0, 2]]) },
  { id: 'v3', name: 'Line 3V', cells: Object.freeze([[0, 0], [1, 0], [2, 0]]) },
  // 4-cell lines
  { id: 'h4', name: 'Line 4H', cells: Object.freeze([[0, 0], [0, 1], [0, 2], [0, 3]]) },
  { id: 'v4', name: 'Line 4V', cells: Object.freeze([[0, 0], [1, 0], [2, 0], [3, 0]]) },
  // 5-cell lines
  { id: 'h5', name: 'Line 5H', cells: Object.freeze([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]) },
  { id: 'v5', name: 'Line 5V', cells: Object.freeze([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]) },
  // 2x2 square
  { id: 'sq2', name: 'Square 2x2', cells: Object.freeze([[0, 0], [0, 1], [1, 0], [1, 1]]) },
  // 3x3 square
  { id: 'sq3', name: 'Square 3x3', cells: Object.freeze([
    [0, 0], [0, 1], [0, 2],
    [1, 0], [1, 1], [1, 2],
    [2, 0], [2, 1], [2, 2]
  ]) },
  // 3-cell corners (small L, 4 rotations)
  { id: 'c1', name: 'Corner 1', cells: Object.freeze([[0, 0], [1, 0], [1, 1]]) },
  { id: 'c2', name: 'Corner 2', cells: Object.freeze([[0, 1], [1, 1], [1, 0]]) },
  { id: 'c3', name: 'Corner 3', cells: Object.freeze([[0, 0], [0, 1], [1, 0]]) },
  { id: 'c4', name: 'Corner 4', cells: Object.freeze([[0, 0], [0, 1], [1, 1]]) },
  // 5-cell big L (4 rotations)
  { id: 'l1', name: 'Big L 1', cells: Object.freeze([[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]) },
  { id: 'l2', name: 'Big L 2', cells: Object.freeze([[0, 2], [1, 2], [2, 2], [2, 1], [2, 0]]) },
  { id: 'l3', name: 'Big L 3', cells: Object.freeze([[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]]) },
  { id: 'l4', name: 'Big L 4', cells: Object.freeze([[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]]) },
  // 4-cell T-shapes (4 rotations)
  { id: 't1', name: 'T 1', cells: Object.freeze([[0, 1], [1, 0], [1, 1], [1, 2]]) },
  { id: 't2', name: 'T 2', cells: Object.freeze([[0, 0], [1, 0], [2, 0], [1, 1]]) },
  { id: 't3', name: 'T 3', cells: Object.freeze([[0, 0], [0, 1], [0, 2], [1, 1]]) },
  { id: 't4', name: 'T 4', cells: Object.freeze([[0, 1], [1, 0], [1, 1], [2, 1]]) }
]);

export function nextRandom(state) {
  let x = state.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 4294967296;
}

export function spawnRack(state) {
  const rack = [];
  for (let i = 0; i < 3; i++) {
    const shapeIndex = Math.floor(nextRandom(state) * SHAPES.length);
    rack.push({ ...SHAPES[shapeIndex], used: false });
  }
  return rack;
}

export function newBlocksGame(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid game seed');
  const state = {
    board: Array(TOTAL_CELLS).fill(0),
    score: 0,
    linesCleared: 0,
    streak: 0,
    moves: 0,
    rng: (seed >>> 0) || 0x1f2e3d4c,
    rack: [],
    over: false
  };
  state.rack = spawnRack(state);
  return state;
}

export function canPlace(board, shape, row, col) {
  if (!shape || !Array.isArray(shape.cells)) return false;
  for (const [dr, dc] of shape.cells) {
    const r = row + dr;
    const c = col + dc;
    if (r < 0 || r >= GRID_SIZE || c < 0 || c >= GRID_SIZE) return false;
    if (board[r * GRID_SIZE + c] !== 0) return false;
  }
  return true;
}

export function canFitAnywhere(board, shape) {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (canPlace(board, shape, r, c)) return true;
    }
  }
  return false;
}

export function checkGameOver(board, rack) {
  const available = rack.filter(item => item && !item.used);
  if (!available.length) return false;
  for (const item of available) {
    if (canFitAnywhere(board, item)) return false;
  }
  return true;
}

/**
 * Places a piece from the rack at board coordinate (row, col).
 * Does not mutate the original state argument.
 */
export function placeBlock(state, rackIndex, row, col) {
  if (state.over) return { state, valid: false, clearedCount: 0, pointsGained: 0 };
  if (!Number.isInteger(rackIndex) || rackIndex < 0 || rackIndex >= state.rack.length) {
    throw new Error('Invalid rack index');
  }
  const item = state.rack[rackIndex];
  if (!item || item.used) return { state, valid: false, clearedCount: 0, pointsGained: 0 };
  if (!Number.isInteger(row) || !Number.isInteger(col)) throw new Error('Invalid coordinates');
  if (!canPlace(state.board, item, row, col)) return { state, valid: false, clearedCount: 0, pointsGained: 0 };

  const nextBoard = [...state.board];
  // Mark cells placed
  for (const [dr, dc] of item.cells) {
    nextBoard[(row + dr) * GRID_SIZE + (col + dc)] = 1;
  }

  // Find full rows and cols
  const fullRows = [];
  const fullCols = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    let full = true;
    for (let c = 0; c < GRID_SIZE; c++) {
      if (nextBoard[r * GRID_SIZE + c] === 0) { full = false; break; }
    }
    if (full) fullRows.push(r);
  }
  for (let c = 0; c < GRID_SIZE; c++) {
    let full = true;
    for (let r = 0; r < GRID_SIZE; r++) {
      if (nextBoard[r * GRID_SIZE + c] === 0) { full = false; break; }
    }
    if (full) fullCols.push(c);
  }

  // Clear full lines
  for (const r of fullRows) {
    for (let c = 0; c < GRID_SIZE; c++) nextBoard[r * GRID_SIZE + c] = 0;
  }
  for (const c of fullCols) {
    for (let r = 0; r < GRID_SIZE; r++) nextBoard[r * GRID_SIZE + c] = 0;
  }

  const totalLines = fullRows.length + fullCols.length;
  let linePoints = 0;
  let nextStreak = state.streak;
  if (totalLines > 0) {
    nextStreak += 1;
    // Multi-line exponential reward: 1=10, 2=30, 3=60, 4=100, 5+=150+
    linePoints = Math.round(5 * totalLines * (totalLines + 1)) + (nextStreak * 10);
    // Board wipe bonus
    if (!nextBoard.some(v => v !== 0)) {
      linePoints += 300;
    }
  } else {
    nextStreak = 0;
  }

  const piecePoints = item.cells.length;
  const pointsGained = piecePoints + linePoints;

  // Update rack
  const nextRack = state.rack.map((p, idx) => idx === rackIndex ? { ...p, used: true } : p);
  const remainingInRack = nextRack.filter(p => !p.used).length;

  let freshRack = nextRack;
  const rngState = { rng: state.rng };
  if (remainingInRack === 0) {
    freshRack = spawnRack(rngState);
  }

  const isOver = checkGameOver(nextBoard, freshRack);

  const nextState = {
    board: nextBoard,
    score: state.score + pointsGained,
    linesCleared: state.linesCleared + totalLines,
    streak: nextStreak,
    moves: state.moves + 1,
    rng: rngState.rng,
    rack: freshRack,
    over: isOver
  };

  return { state: nextState, valid: true, clearedCount: totalLines, pointsGained };
}

export function replayBlocks(seed, moves) {
  let current = newBlocksGame(seed);
  for (const m of moves) {
    const { rackIndex, row, col } = m;
    const result = placeBlock(current, rackIndex, row, col);
    if (!result.valid) throw new Error('Invalid move in sequence');
    current = result.state;
  }
  return current;
}

export function coinsForBlocksScore(score) {
  // Bounded non-withdrawable virtual currency award:
  // e.g. 50 score -> 1 coin, 200 -> 4 coins, max 15 coins per session
  return Math.max(0, Math.min(15, Math.floor(score / 50)));
}
