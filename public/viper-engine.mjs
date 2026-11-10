/**
 * Neon Viper (Reflex Snake Arcade) deterministic engine.
 * Pure ES module: zero DOM, network, or external dependencies.
 */

export const GRID_SIZE = 16;
export const OPPOSITE_DIRECTIONS = Object.freeze({
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left'
});

export const DIR_DELTA = Object.freeze({
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 }
});

export function nextRandom(state) {
  let x = state.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 4294967296;
}

export function spawnFood(rngState, snake) {
  const occupied = new Set();
  for (const seg of snake) {
    occupied.add(seg.r * GRID_SIZE + seg.c);
  }

  const freeCells = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const idx = r * GRID_SIZE + c;
      if (!occupied.has(idx)) {
        freeCells.push({ r, c });
      }
    }
  }

  if (freeCells.length === 0) return null;
  const pick = Math.floor(nextRandom(rngState) * freeCells.length);
  return freeCells[pick];
}

export function newViperGame(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid game seed');
  const rngState = { rng: (seed >>> 0) || 0x12345678 };

  // Snake starts in center moving right, length 3
  const mid = Math.floor(GRID_SIZE / 2);
  const snake = [
    { r: mid, c: mid + 1 }, // head
    { r: mid, c: mid },     // body
    { r: mid, c: mid - 1 }  // tail
  ];

  const food = spawnFood(rngState, snake);

  return {
    snake,
    dir: 'right',
    food,
    score: 0,
    foodEaten: 0,
    moves: 0,
    over: false,
    rng: rngState.rng,
    seed
  };
}

export function stepSnake(state, requestedDir) {
  if (state.over) return state;

  const validDirs = ['up', 'down', 'left', 'right'];
  const dirInput = typeof requestedDir === 'string' ? requestedDir.toLowerCase() : state.dir;
  if (!validDirs.includes(dirInput)) throw new Error('Invalid direction');

  // Prevent immediate 180 reverse if snake has body
  let nextDir = dirInput;
  if (state.snake.length > 1 && OPPOSITE_DIRECTIONS[dirInput] === state.dir) {
    nextDir = state.dir;
  }

  const delta = DIR_DELTA[nextDir];
  const head = state.snake[0];
  const newHead = { r: head.r + delta.dr, c: head.c + delta.dc };

  // Check wall collision
  if (newHead.r < 0 || newHead.r >= GRID_SIZE || newHead.c < 0 || newHead.c >= GRID_SIZE) {
    return {
      ...state,
      dir: nextDir,
      moves: state.moves + 1,
      over: true
    };
  }

  const eatsFood = state.food && newHead.r === state.food.r && newHead.c === state.food.c;

  // Check self collision (if not eating food, tail will pop so tail position is safe)
  const bodyToCheck = eatsFood ? state.snake : state.snake.slice(0, -1);
  const hitsSelf = bodyToCheck.some(seg => seg.r === newHead.r && seg.c === newHead.c);

  if (hitsSelf) {
    return {
      ...state,
      dir: nextDir,
      moves: state.moves + 1,
      over: true
    };
  }

  // Move snake
  const nextSnake = [newHead, ...state.snake];
  let nextFood = state.food;
  let pointsEarned = 0;
  let foodCount = state.foodEaten;
  const rngState = { rng: state.rng };

  if (eatsFood) {
    foodCount += 1;
    pointsEarned = 100 + foodCount * 15;
    nextFood = spawnFood(rngState, nextSnake);
  } else {
    nextSnake.pop(); // remove tail
  }

  const isFullBoard = nextSnake.length >= GRID_SIZE * GRID_SIZE;

  return {
    ...state,
    snake: nextSnake,
    dir: nextDir,
    food: nextFood,
    score: state.score + pointsEarned,
    foodEaten: foodCount,
    moves: state.moves + 1,
    over: isFullBoard,
    rng: rngState.rng
  };
}

export function replayViper(seed, moves) {
  let current = newViperGame(seed);
  for (const m of moves) {
    const dir = typeof m === 'string' ? m : m?.dir;
    if (typeof dir !== 'string') throw new Error('Invalid viper move');
    current = stepSnake(current, dir);
    if (current.over) break;
  }
  return current;
}

export function coinsForViperScore(score) {
  // Bounded non-withdrawable virtual currency:
  // e.g. 150 points -> 1 coin, max 15 coins per run
  return Math.max(0, Math.min(15, Math.floor(score / 150)));
}
