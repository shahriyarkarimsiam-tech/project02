import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newViperGame,
  stepSnake,
  replayViper,
  coinsForViperScore,
  GRID_SIZE
} from '../public/viper-engine.mjs';

test('newViperGame initializes centered 3-segment snake and valid food', () => {
  const game = newViperGame(12345);
  assert.equal(game.snake.length, 3);
  assert.equal(game.dir, 'right');
  assert.equal(game.score, 0);
  assert.equal(game.foodEaten, 0);
  assert.equal(game.moves, 0);
  assert.equal(game.over, false);

  // Snake head is to the right of body
  assert.equal(game.snake[0].r, 8);
  assert.equal(game.snake[0].c, 9);
  assert.equal(game.snake[1].r, 8);
  assert.equal(game.snake[1].c, 8);
  assert.equal(game.snake[2].r, 8);
  assert.equal(game.snake[2].c, 7);

  // Food is within bounds and not on snake
  assert(game.food.r >= 0 && game.food.r < GRID_SIZE);
  assert(game.food.c >= 0 && game.food.c < GRID_SIZE);
  const onSnake = game.snake.some(s => s.r === game.food.r && s.c === game.food.c);
  assert.equal(onSnake, false);
});

test('stepSnake moves straight and advances coordinates without mutating input', () => {
  const original = newViperGame(42);
  const next = stepSnake(original, 'right');

  // Input was not mutated
  assert.equal(original.moves, 0);
  assert.equal(original.snake[0].c, 9);

  // Next state moved right
  assert.equal(next.moves, 1);
  assert.equal(next.snake[0].r, 8);
  assert.equal(next.snake[0].c, 10);
  assert.equal(next.snake.length, 3);
  assert.equal(next.over, false);
});

test('stepSnake rejects 180 degree immediate reverse into itself', () => {
  const game = newViperGame(42); // moving 'right'
  const reversed = stepSnake(game, 'left'); // illegal 180 reverse

  // Should ignore left and continue right
  assert.equal(reversed.dir, 'right');
  assert.equal(reversed.snake[0].c, 10);
});

test('stepSnake ends game on wall collision', () => {
  let game = newViperGame(999);
  // Move right until hitting wall at c = 15
  for (let i = 0; i < 20; i++) {
    game = stepSnake(game, 'right');
    if (game.over) break;
  }
  assert.equal(game.over, true);
});

test('stepSnake eats food, grows, increments score and spawns new food', () => {
  const game = newViperGame(777);
  // Manually place food directly in front of head
  game.food = { r: 8, c: 10 };

  const next = stepSnake(game, 'right');
  assert.equal(next.snake.length, 4); // grew by 1
  assert.equal(next.foodEaten, 1);
  assert(next.score > 0);
  assert(next.food);
  assert.notDeepEqual(next.food, { r: 8, c: 10 }); // new food spawned
});

test('stepSnake ends game on self collision', () => {
  // Construct snake with length 5 in U-shape
  let state = {
    snake: [
      { r: 5, c: 5 }, // head
      { r: 5, c: 4 },
      { r: 6, c: 4 },
      { r: 6, c: 5 },
      { r: 6, c: 6 }
    ],
    dir: 'right',
    food: { r: 0, c: 0 },
    score: 500,
    foodEaten: 4,
    moves: 10,
    over: false,
    rng: 1234567,
    seed: 42
  };

  // Turn down: head will move to (6, 5), which collides with body!
  const collided = stepSnake(state, 'down');
  assert.equal(collided.over, true);
});

test('replayViper deterministically reproduces identical state', () => {
  const seed = 54321;
  const moves = ['right', 'right', 'down', 'down', 'left', 'up'];

  const run1 = replayViper(seed, moves);
  const run2 = replayViper(seed, moves);

  assert.equal(run1.score, run2.score);
  assert.equal(run1.foodEaten, run2.foodEaten);
  assert.equal(run1.moves, run2.moves);
  assert.deepEqual(run1.snake, run2.snake);
  assert.deepEqual(run1.food, run2.food);
});

test('coinsForViperScore bounds virtual currency reward', () => {
  assert.equal(coinsForViperScore(0), 0);
  assert.equal(coinsForViperScore(150), 1);
  assert.equal(coinsForViperScore(1500), 10);
  assert.equal(coinsForViperScore(50000), 15); // capped at 15
});
