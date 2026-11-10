import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newColorGame,
  findMatches,
  swapGems,
  replayColors,
  coinsForColorsScore,
  BOARD_SIZE,
  TOTAL_CELLS,
  MAX_MOVES
} from '../public/color-engine.mjs';

test('newColorGame creates 7x7 board without starting matches', () => {
  const game = newColorGame(12345);
  assert.equal(game.board.length, TOTAL_CELLS);
  assert.equal(game.moves, 0);
  assert.equal(game.maxMoves, MAX_MOVES);
  assert.equal(game.score, 0);
  assert.equal(game.over, false);
  const matches = findMatches(game.board);
  assert.equal(matches.length, 0, 'Initial board should have 0 matches');
});

test('findMatches identifies horizontal and vertical lines', () => {
  // Empty board
  const board = Array(TOTAL_CELLS).fill(0);
  // Give distinct values
  for (let i = 0; i < TOTAL_CELLS; i++) board[i] = i % 5;

  // Manually force a horizontal 3-in-a-row at row 0, cols 1,2,3
  board[0 * 7 + 1] = 4;
  board[0 * 7 + 2] = 4;
  board[0 * 7 + 3] = 4;

  // Manually force a vertical 3-in-a-column at col 6, rows 2,3,4
  board[2 * 7 + 6] = 2;
  board[3 * 7 + 6] = 2;
  board[4 * 7 + 6] = 2;

  const matches = findMatches(board);
  assert(matches.includes(0 * 7 + 1));
  assert(matches.includes(0 * 7 + 2));
  assert(matches.includes(0 * 7 + 3));
  assert(matches.includes(2 * 7 + 6));
  assert(matches.includes(3 * 7 + 6));
  assert(matches.includes(4 * 7 + 6));
});

test('swapGems rejects non-adjacent and invalid swaps', () => {
  const game = newColorGame(999);
  // Diagonal
  const diag = swapGems(game, 0, 0, 1, 1);
  assert.equal(diag.valid, false);
  // Out of bounds
  const oob = swapGems(game, 0, 0, -1, 0);
  assert.equal(oob.valid, false);
  // Distance > 1
  const far = swapGems(game, 0, 0, 0, 2);
  assert.equal(far.valid, false);
});

test('swapGems rejects swap that produces no match without mutating state', () => {
  const game = newColorGame(5555);
  const originalBoard = [...game.board];
  // Attempt swap of row 0 col 0 with row 0 col 1
  // If it doesn't match 3, it should reject
  let foundNoMatchPair = null;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE - 1; c++) {
      const res = swapGems(game, r, c, r, c + 1);
      if (!res.valid) {
        foundNoMatchPair = { r, c };
        break;
      }
    }
    if (foundNoMatchPair) break;
  }
  assert(foundNoMatchPair !== null);
  assert.deepEqual(game.board, originalBoard, 'Original state must not mutate');
  assert.equal(game.moves, 0);
  assert.equal(game.score, 0);
});

test('swapGems performs valid match, awards points and drops new gems', () => {
  const game = newColorGame(424242);
  // Let's create a guaranteed swap opportunity
  // Setup: row 2 col 0 = 1, row 2 col 1 = 1, row 2 col 3 = 1, row 2 col 2 = 3
  // Swapping (2, 2) and (2, 3) makes row 2 cols 0, 1, 2 all equal 1!
  const customBoard = [...game.board];
  customBoard[2 * 7 + 0] = 1;
  customBoard[2 * 7 + 1] = 1;
  customBoard[2 * 7 + 2] = 3;
  customBoard[2 * 7 + 3] = 1;
  const stateWithSetup = { ...game, board: customBoard };

  const res = swapGems(stateWithSetup, 2, 2, 2, 3);
  assert.equal(res.valid, true);
  assert(res.pointsGained >= 30);
  assert(res.cascades >= 1);
  assert.equal(res.state.moves, 1);
  assert(res.state.score >= 30);
  assert.equal(res.state.board.length, TOTAL_CELLS);
  // Board should have no -1 values (all refilled)
  assert.equal(res.state.board.includes(-1), false);
});

test('replayColors reproduces exact game score and state', () => {
  const seed = 778899;
  let game = newColorGame(seed);
  const moves = [];

  // Find 3 valid swaps dynamically
  for (let step = 0; step < 3; step++) {
    let madeMove = false;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        // Try right
        if (c + 1 < BOARD_SIZE) {
          const res = swapGems(game, r, c, r, c + 1);
          if (res.valid) {
            moves.push({ r1: r, c1: c, r2: r, c2: c + 1 });
            game = res.state;
            madeMove = true;
            break;
          }
        }
        // Try down
        if (r + 1 < BOARD_SIZE) {
          const res = swapGems(game, r, c, r + 1, c);
          if (res.valid) {
            moves.push({ r1: r, c1: c, r2: r + 1, c2: c });
            game = res.state;
            madeMove = true;
            break;
          }
        }
      }
      if (madeMove) break;
    }
  }

  assert(moves.length >= 1, 'Should find at least 1 valid swap move');
  const replayed = replayColors(seed, moves);
  assert.equal(replayed.score, game.score);
  assert.equal(replayed.moves, game.moves);
  assert.deepEqual(replayed.board, game.board);
});

test('coinsForColorsScore bounds virtual rewards', () => {
  assert.equal(coinsForColorsScore(0), 0);
  assert.equal(coinsForColorsScore(149), 0);
  assert.equal(coinsForColorsScore(150), 1);
  assert.equal(coinsForColorsScore(450), 3);
  assert.equal(coinsForColorsScore(99999), 15, 'Bounded to max 15');
});
