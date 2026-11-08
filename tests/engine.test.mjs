import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, move, replay, hasMoves, coinsForScore } from '../public/engine.mjs';

test('initial board has exactly two pieces', () => {
  const state = newGame(17);
  assert.equal(state.board.filter(Boolean).length, 2);
  assert.equal(state.score, 0);
});
test('spawns are deterministic, replay matches user moves', () => {
  const moves = [];
  let game = newGame(325);
  for (let n = 0; n < 55; n++) {
    const option = ['left', 'down', 'right', 'up'][n % 4];
    const result = move(game, option);
    if (result.changed) { moves.push(option); game = result.state; }
  }
  assert.deepEqual(replay(325, moves), game);
});
test('merging gives correct points and does not mutate argument', () => {
  const start = { board: [2, 2, 4, 4, 0,0,0,0, 0,0,0,0, 0,0,0,0], score: 0, moves: 0, rng: 300, over: false };
  const updated = move(start, 'left');
  assert.equal(updated.gained, 12);
  assert.equal(updated.state.score, 12);
  assert.equal(start.board[1], 2);
  assert.equal(updated.state.board[0], 4);
  assert.equal(updated.state.board[1], 8);
});
test('history rejects invalid directions or no-ops', () => {
  assert.throws(() => replay(33, ['bad']));
  assert.throws(() => replay(33, Array(1501).fill('up')));
  const s = { board: [2,0,0,0,...Array(12).fill(0)], score: 0, moves: 0, rng: 1, over: false };
  assert.equal(move(s, 'left').changed, false);
});
test('game over detects full board without adjacent matches', () => {
  const board = Array.from({length:16}, (_,i)=> ((Math.floor(i / 4)+i%4)%2 ? 4 : 2));
  assert.equal(hasMoves(board), false);
  assert.equal(hasMoves([0,...board.slice(1)]), true);
});
test('coin awards remain virtual and bounded', () => {
  assert.equal(coinsForScore(0), 0);
  assert.equal(coinsForScore(1280), 10);
  assert.equal(coinsForScore(1000000), 40);
});
