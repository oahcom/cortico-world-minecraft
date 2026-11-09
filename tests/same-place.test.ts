/**
 * 「同一片地方」判定的自检。
 *
 * 回归的是 2026-11-08 那 19 次死亡:她那五条命铺在同一片 30 格见方的地方,
 * 而旧的 cell 全等判定一次都没点出来(20 条记录里只触发 2 次)。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { samePlace } from '../src/death-place.ts';

test('同格判同片', () => {
  assert.equal(samePlace('minecraft:overworld:21,48,-373', 'minecraft:overworld:21,48,-373'), true);
});

test('摔死落点差一两格仍算同一片', () => {
  // 实测 (21,48,-373) 与 (16,44,-373) 同属 14:15–15:04 那一轮死亡循环
  assert.equal(samePlace('minecraft:overworld:21,48,-373', 'minecraft:overworld:16,44,-373'), true);
  assert.equal(samePlace('minecraft:overworld:-5,63,-373', 'minecraft:overworld:8,63,-377'), true);
});

test('水平 16 格内算同片,超出不算', () => {
  assert.equal(samePlace('minecraft:overworld:0,64,0', 'minecraft:overworld:16,64,0'), true);
  assert.equal(samePlace('minecraft:overworld:0,64,0', 'minecraft:overworld:17,64,0'), false);
});

test('垂直差多少都不影响:摔死与被打死在同一条竖直线上是同一片', () => {
  assert.equal(samePlace('minecraft:overworld:0,80,0', 'minecraft:overworld:0,20,0'), true);
});

test('跨维度一律不同片', () => {
  assert.equal(samePlace('minecraft:overworld:0,64,0', 'minecraft:the_nether:0,64,0'), false);
});

test('解析不出来退回全等,不凭空并格', () => {
  assert.equal(samePlace(null, 'minecraft:overworld:0,64,0'), false);
  assert.equal(samePlace('坏数据', 'minecraft:overworld:0,64,0'), false);
  assert.equal(samePlace('坏数据', '坏数据'), true);
});
