import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSleep, MAX_SLEEP_FAILURES, BED_REACH, SLEEP_COOLDOWN_MS } from '../src/auto-sleep.ts';

/** 默认是一份"该睡了"的现场:夜里、床在脚边 2 格、没挨打 */
const base = {
  timeOfDay: 15_000,
  bed: [10, 64, 10] as const,
  pos: [10, 64, 8] as const,
  sleeping: false,
  threatened: false,
  failures: 0,
};

test('夜里床在脚边就该睡', () => {
  assert.equal(shouldSleep({ ...base }), true);
});

test('白天不睡', () => {
  assert.equal(shouldSleep({ ...base, timeOfDay: 6_000 }), false);
});

test('刚入夜那半秒先不打断她', () => {
  assert.equal(shouldSleep({ ...base, timeOfDay: 13_000 }), false);
  assert.equal(shouldSleep({ ...base, timeOfDay: 13_600 }), true);
});

test('天已经亮了就不睡', () => {
  assert.equal(shouldSleep({ ...base, timeOfDay: 23_000 }), false);
});

test('已经在床上就不要再喊', () => {
  assert.equal(shouldSleep({ ...base, sleeping: true }), false);
});

test('身边有怪时不躺下', () => {
  assert.equal(shouldSleep({ ...base, threatened: true }), false);
});

test('床不在手边就不算该睡(不替她跑过去)', () => {
  assert.equal(shouldSleep({ ...base, bed: [10, 64, 20] }), false);
  const justInside = [10, 64, 8 + BED_REACH] as const;
  assert.equal(shouldSleep({ ...base, bed: justInside }), true);
});

test('连败到上限就停手', () => {
  assert.equal(shouldSleep({ ...base, failures: MAX_SLEEP_FAILURES - 1 }), true);
  assert.equal(shouldSleep({ ...base, failures: MAX_SLEEP_FAILURES }), false);
});

test('读不到床或坐标时不动', () => {
  assert.equal(shouldSleep({ ...base, bed: null }), false);
  assert.equal(shouldSleep({ ...base, pos: null }), false);
});

test('刚死/正在重生的那几拍不睡(位置还在传送)', () => {
  assert.equal(shouldSleep({ ...base, dead: true }), false);
  // 复活落地之后照常睡
  assert.equal(shouldSleep({ ...base, dead: false }), true);
});

test('冷却够长,不会在 isSleeping 变 true 之前重复下单', () => {
  // 实测 19:00:18/19:00:25、19:47:00/19:47:32、20:05:49/20:06:08 各重复一次;
  // 冷却必须宽于这些间隔,又短于一夜(约 7 分钟)
  assert.ok(SLEEP_COOLDOWN_MS > 40_000);
  assert.ok(SLEEP_COOLDOWN_MS < 7 * 60_000);
});
