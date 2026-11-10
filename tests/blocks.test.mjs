import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newBlocksGame,
  canPlace,
  placeBlock,
  replayBlocks,
  coinsForBlocksScore,
  SHAPES,
  GRID_SIZE
} from '../public/blocks-engine.mjs';

test('newBlocksGame creates empty 8x8 board and 3 valid rack pieces', () => {
  const game = newBlocksGame(12345);
  assert.equal(game.board.length, 64);
  assert.equal(game.board.every(cell => cell === 0), true);
  assert.equal(game.score, 0);
  assert.equal(game.moves, 0);
  assert.equal(game.over, false);
  assert.equal(game.rack.length, 3);
  assert.equal(game.rack.every(p => !p.used && p.cells.length > 0), true);
});

test('canPlace checks boundaries and collisions correctly', () => {
  const game = newBlocksGame(42);
  const h3 = SHAPES.find(s => s.id === 'h3'); // length 3 horizontal
  assert.equal(canPlace(game.board, h3, 0, 0), true);
  assert.equal(canPlace(game.board, h3, 0, 5), true); // ends at col 7
  assert.equal(canPlace(game.board, h3, 0, 6), false); // col 6,7,8 -> 8 is out of bounds
  assert.equal(canPlace(game.board, h3, 8, 0), false); // row out of bounds
});

test('placeBlock places piece and awards piece points without mutating input', () => {
  const initial = newBlocksGame(999);
  const firstPiece = initial.rack[0];
  const { state: next, valid, pointsGained } = placeBlock(initial, 0, 0, 0);

  assert.equal(valid, true);
  assert.equal(pointsGained, firstPiece.cells.length);
  assert.equal(next.score, firstPiece.cells.length);
  assert.equal(next.moves, 1);
  assert.equal(next.rack[0].used, true);

  // Original state immutability
  assert.equal(initial.board[0], 0);
  assert.equal(initial.score, 0);
  assert.equal(initial.rack[0].used, false);
});

test('placeBlock clears full row and awards combo score', () => {
  const game = newBlocksGame(1);
  // Pre-fill row 0 except col 0
  for (let c = 1; c < GRID_SIZE; c++) {
    game.board[c] = 1;
  }
  // Use dot shape (1x1) at [0, 0]
  const dotShape = { id: 'dot', name: 'Dot', cells: [[0, 0]] };
  game.rack[0] = { ...dotShape, used: false };

  const { state: next, valid, clearedCount, pointsGained } = placeBlock(game, 0, 0, 0);
  assert.equal(valid, true);
  assert.equal(clearedCount, 1);
  assert.ok(pointsGained > 10);
  // Row 0 should be completely cleared
  for (let c = 0; c < GRID_SIZE; c++) {
    assert.equal(next.board[c], 0);
  }
});

test('spawns new rack when all 3 pieces are used', () => {
  let game = newBlocksGame(777);
  // Place 3 pieces in empty spaces
  // Find safe places for all 3
  for (let i = 0; i < 3; i++) {
    const piece = game.rack[i];
    let placed = false;
    for (let r = 0; r < GRID_SIZE && !placed; r++) {
      for (let c = 0; c < GRID_SIZE && !placed; c++) {
        if (canPlace(game.board, piece, r, c)) {
          const res = placeBlock(game, i, r, c);
          if (res.valid) {
            game = res.state;
            placed = true;
          }
        }
      }
    }
    assert.equal(placed, true, `Piece ${i} should be placed`);
  }
  // After 3 placed, a new fresh rack of 3 un-used pieces should exist
  assert.equal(game.rack.length, 3);
  assert.equal(game.rack.every(p => !p.used), true);
});

test('replayBlocks reproduces exact game score and state', () => {
  const seed = 54321;
  let game = newBlocksGame(seed);
  const moves = [];

  // Play 4 valid moves
  for (let step = 0; step < 4; step++) {
    const availableIndex = game.rack.findIndex(p => !p.used);
    const piece = game.rack[availableIndex];
    let placed = false;
    for (let r = 0; r < GRID_SIZE && !placed; r++) {
      for (let c = 0; c < GRID_SIZE && !placed; c++) {
        if (canPlace(game.board, piece, r, c)) {
          moves.push({ rackIndex: availableIndex, row: r, col: c });
          const res = placeBlock(game, availableIndex, r, c);
          game = res.state;
          placed = true;
        }
      }
    }
  }

  const replayed = replayBlocks(seed, moves);
  assert.equal(replayed.score, game.score);
  assert.equal(replayed.moves, game.moves);
  assert.deepEqual(replayed.board, game.board);
});

test('coinsForBlocksScore awards bounded virtual coins', () => {
  assert.equal(coinsForBlocksScore(0), 0);
  assert.equal(coinsForBlocksScore(49), 0);
  assert.equal(coinsForBlocksScore(50), 1);
  assert.equal(coinsForBlocksScore(150), 3);
  assert.equal(coinsForBlocksScore(5000), 15); // capped at 15
});
