import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newMemoryGame,
  tapPad,
  replayMemory,
  coinsForMemoryScore,
  NUM_PADS,
  MAX_LIVES
} from '../public/memory-engine.mjs';

test('newMemoryGame initializes correctly with 3 lives and round 1', () => {
  const game = newMemoryGame(12345);
  assert.equal(game.score, 0);
  assert.equal(game.round, 1);
  assert.equal(game.step, 0);
  assert.equal(game.lives, MAX_LIVES);
  assert.equal(game.over, false);
  assert.equal(game.sequence.length, 50);
  assert(game.sequence.every(pad => pad >= 0 && pad < NUM_PADS));
});

test('tapPad advances on correct pad and awards points on round clear', () => {
  const game = newMemoryGame(8888);
  const target = game.sequence[0];

  const res = tapPad(game, target);
  assert.equal(res.valid, true);
  assert.equal(res.correct, true);
  assert.equal(res.roundCleared, true);
  assert.equal(res.state.round, 2);
  assert.equal(res.state.step, 0);
  assert.equal(res.state.lives, 3);
  assert(res.pointsGained > 0);
  assert.equal(res.state.score, res.pointsGained);
});

test('tapPad reduces life on wrong pad and game ends after 3 mistakes', () => {
  const game = newMemoryGame(9999);
  const expected = game.sequence[0];
  const wrongPad = (expected + 1) % NUM_PADS;

  // Mistake 1
  const m1 = tapPad(game, wrongPad);
  assert.equal(m1.correct, false);
  assert.equal(m1.state.lives, 2);
  assert.equal(m1.state.over, false);

  // Mistake 2
  const m2 = tapPad(m1.state, wrongPad);
  assert.equal(m2.correct, false);
  assert.equal(m2.state.lives, 1);
  assert.equal(m2.state.over, false);

  // Mistake 3 -> Game Over
  const m3 = tapPad(m2.state, wrongPad);
  assert.equal(m3.correct, false);
  assert.equal(m3.state.lives, 0);
  assert.equal(m3.state.over, true);
});

test('replayMemory reproduces exact game state for sequence of moves', () => {
  const seed = 54321;
  let game = newMemoryGame(seed);
  const moves = [];

  // Play through round 1 and round 2 perfectly
  // Round 1
  moves.push({ pad: game.sequence[0] });
  game = tapPad(game, game.sequence[0]).state;

  // Round 2
  moves.push({ pad: game.sequence[0] });
  game = tapPad(game, game.sequence[0]).state;
  moves.push({ pad: game.sequence[1] });
  game = tapPad(game, game.sequence[1]).state;

  assert.equal(game.round, 3);
  const replayed = replayMemory(seed, moves);
  assert.equal(replayed.score, game.score);
  assert.equal(replayed.round, game.round);
  assert.equal(replayed.lives, game.lives);
  assert.equal(replayed.moves, game.moves);
});

test('coinsForMemoryScore bounds virtual currency reward', () => {
  assert.equal(coinsForMemoryScore(0), 0);
  assert.equal(coinsForMemoryScore(199), 0);
  assert.equal(coinsForMemoryScore(200), 1);
  assert.equal(coinsForMemoryScore(600), 3);
  assert.equal(coinsForMemoryScore(50000), 15);
});
