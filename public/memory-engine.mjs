/**
 * Memory Matrix (Pattern Sequence Memory Arcade) deterministic engine.
 * Pure ES module: no DOM, network, or external dependencies.
 */

export const NUM_PADS = 9;
export const MAX_LIVES = 3;
export const MAX_ROUNDS = 50;

export const PADS = Object.freeze([
  { id: 0, name: 'Cyan', color: '#00f0ff', note: 'C4', freq: 261.63, symbol: '✦' },
  { id: 1, name: 'Pink', color: '#ff007f', note: 'D4', freq: 293.66, symbol: '▲' },
  { id: 2, name: 'Yellow', color: '#ffea00', note: 'E4', freq: 329.63, symbol: '★' },
  { id: 3, name: 'Lime', color: '#39ff14', note: 'F4', freq: 349.23, symbol: '●' },
  { id: 4, name: 'Purple', color: '#b5179e', note: 'G4', freq: 392.00, symbol: '◆' },
  { id: 5, name: 'Orange', color: '#ff7700', note: 'A4', freq: 440.00, symbol: '■' },
  { id: 6, name: 'Blue', color: '#3a86ff', note: 'B4', freq: 493.88, symbol: '⬟' },
  { id: 7, name: 'Emerald', color: '#06d6a0', note: 'C5', freq: 523.25, symbol: '✿' },
  { id: 8, name: 'Amber', color: '#f77f00', note: 'D5', freq: 587.33, symbol: '⚡' }
]);

export function nextRandom(state) {
  let x = state.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return state.rng / 4294967296;
}

export function generateSequence(seed, length = MAX_ROUNDS) {
  const rngState = { rng: (seed >>> 0) || 0x3c4d5e6f };
  const seq = [];
  for (let i = 0; i < length; i++) {
    seq.push(Math.floor(nextRandom(rngState) * NUM_PADS));
  }
  return seq;
}

export function newMemoryGame(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid game seed');
  const sequence = generateSequence(seed);
  return {
    score: 0,
    round: 1,
    step: 0,
    lives: MAX_LIVES,
    moves: 0,
    streak: 0,
    sequence,
    seed,
    over: false
  };
}

/**
 * Player inputs a pad tap.
 * Returns { state: nextState, valid: boolean, correct: boolean, roundCleared: boolean, pointsGained: number }
 */
export function tapPad(state, pad) {
  if (state.over) return { state, valid: false, correct: false, roundCleared: false, pointsGained: 0 };
  if (!Number.isInteger(pad) || pad < 0 || pad >= NUM_PADS) throw new Error('Invalid pad');

  const expected = state.sequence[state.step];
  const isCorrect = pad === expected;

  if (isCorrect) {
    const nextStep = state.step + 1;
    const stepPoints = state.round * 15;
    let pointsGained = stepPoints;
    let nextRound = state.round;
    let roundCleared = false;
    let finalStep = nextStep;
    let nextStreak = state.streak + 1;

    // Check if player completed the full sequence for this round
    if (nextStep >= state.round) {
      roundCleared = true;
      const roundBonus = state.round * 75;
      pointsGained += roundBonus;
      nextRound = state.round + 1;
      finalStep = 0;
    }

    const isOver = nextRound > MAX_ROUNDS;

    const nextState = {
      ...state,
      score: state.score + pointsGained,
      round: nextRound,
      step: finalStep,
      streak: nextStreak,
      moves: state.moves + 1,
      over: isOver
    };

    return { state: nextState, valid: true, correct: true, roundCleared, pointsGained };
  } else {
    // Incorrect tap: lose 1 life and reset current round step
    const nextLives = state.lives - 1;
    const isOver = nextLives <= 0;

    const nextState = {
      ...state,
      lives: Math.max(0, nextLives),
      step: 0,
      streak: 0,
      moves: state.moves + 1,
      over: isOver
    };

    return { state: nextState, valid: true, correct: false, roundCleared: false, pointsGained: 0 };
  }
}

export function replayMemory(seed, moves) {
  let current = newMemoryGame(seed);
  for (const m of moves) {
    const pad = typeof m === 'number' ? m : m?.pad;
    if (typeof pad !== 'number') throw new Error('Invalid move in memory sequence');
    const result = tapPad(current, pad);
    if (!result.valid) throw new Error('Invalid move');
    current = result.state;
  }
  return current;
}

export function coinsForMemoryScore(score) {
  // Bounded non-withdrawable virtual currency:
  // e.g. 200 points -> 1 coin, max 15 coins per run
  return Math.max(0, Math.min(15, Math.floor(score / 200)));
}
