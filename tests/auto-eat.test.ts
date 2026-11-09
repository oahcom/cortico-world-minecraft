/**
 * 自动进食选餐的自检。
 *
 * 回归的是 2026-11-08 的死亡结构:19 次死亡里 15 次死于战斗,
 * 而回血唯一的路是饥饿 ≥18 —— 所以"饿到 16 还没吃"就是那 15 条命的起点。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMeal, worthEating, EAT_BELOW, EAT_URGENT_BELOW } from '../src/auto-eat.ts';

const meat = { name: 'cooked_beef', count: 3, points: 8 };
const bread = { name: 'bread', count: 2, points: 5 };
const rotten = { name: 'rotten_flesh', count: 10, points: 4 };
const puffer = { name: 'pufferfish', count: 1, points: 1 };

test('不饿就不吃', () => {
  assert.equal(pickMeal([meat], 18), null);
  assert.equal(pickMeal([meat], 20), null);
});

test('掉到线以下就吃', () => {
  assert.notEqual(pickMeal([meat], EAT_BELOW - 1), null);
});

test('平时先吃回得少的,把好口粮留着', () => {
  assert.equal(pickMeal([meat, bread, rotten], 15)?.name, 'rotten_flesh');
  assert.equal(pickMeal([meat, bread], 15)?.name, 'bread');
});

test('急线以下谁回得多吃谁', () => {
  assert.equal(pickMeal([meat, bread, rotten], EAT_URGENT_BELOW)?.name, 'cooked_beef');
});

test('毒食一律不吃,宁可饿着', () => {
  assert.equal(pickMeal([puffer], 10), null);
  assert.equal(pickMeal([puffer, bread], 10)?.name, 'bread');
});

test('没吃的返回 null,不抛异常', () => {
  assert.equal(pickMeal([], 5), null);
  assert.equal(pickMeal([{ name: 'stone', count: 64, points: 0 }], 5), null);
});

test('吃满了就停,不为凑数浪费一口', () => {
  // 饥饿 15、这一口回 8 → 会到 23,溢出,不值得
  assert.equal(worthEating(15, 8), false);
  // 饥饿 15、这一口回 5 → 正好 20
  assert.equal(worthEating(15, 5), true);
  // 急线以下不管溢出
  assert.equal(worthEating(6, 8), true);
  // 不饿
  assert.equal(worthEating(18, 5), false);
});
