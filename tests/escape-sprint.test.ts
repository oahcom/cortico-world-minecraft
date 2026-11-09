import test from 'node:test';
import assert from 'node:assert/strict';
import {
  holdFleeSprint,
  shouldHoldFleeSprint,
  snapFleeLook,
  sprintAway,
  type FleeSprintSnapshot,
} from '../src/escape-sprint.ts';

type Control = 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'sneak' | 'jump';

interface FakeBot {
  entity: {
    position: { x: number; y: number; z: number };
    height: number;
    yaw: number;
    pitch: number;
    isInWater?: boolean;
  };
  food: number;
  pathfinder?: {
    goal?: unknown;
    isMoving?: () => boolean;
    isMining?: () => boolean;
    isBuilding?: () => boolean;
  };
  blockAt?: () => { name: string } | null;
  getControlState: (control: Control) => boolean;
  setControlState: (control: Control, state: boolean) => void;
  lookAt: (point: unknown, force?: boolean) => Promise<void>;
  on: (event: string, listener: () => void) => void;
  removeListener: (event: string, listener: () => void) => void;
  controls: Record<string, boolean>;
  listeners: Array<() => void>;
  lookedAt: unknown[];
}

function fakeBot(overrides: Partial<FakeBot> = {}): FakeBot {
  const controls: Record<string, boolean> = {};
  const listeners: Array<() => void> = [];
  const lookedAt: unknown[] = [];
  const bot: FakeBot = {
    entity: {
      position: { x: 0, y: 64, z: 0 },
      height: 1.8,
      yaw: 0,
      pitch: 0,
    },
    food: 20,
    getControlState: (control) => controls[control] ?? false,
    setControlState: (control, state) => { controls[control] = state; },
    lookAt: (point) => {
      lookedAt.push(point);
      return Promise.resolve();
    },
    on: (_event, listener) => { listeners.push(listener); },
    removeListener: (_event, listener) => {
      const i = listeners.indexOf(listener);
      if (i >= 0) listeners.splice(i, 1);
    },
    controls,
    listeners,
    lookedAt,
    ...overrides,
  };
  return bot;
}

const goodSnapshot: FleeSprintSnapshot = {
  pathMoving: true,
  mining: false,
  building: false,
  forward: true,
  jump: false,
  inWater: false,
  unsafeGround: false,
  food: 20,
};

test('手动撤退先同步转向，再按正前方与疾跑', () => {
  const bot = fakeBot();
  assert.equal(sprintAway(bot as never, 0, 1), true);
  assert.equal(bot.controls.forward, true);
  assert.equal(bot.controls.sprint, true);
  assert.equal(bot.controls.back, false);
  assert.equal(bot.controls.left, false);
  assert.equal(bot.controls.right, false);
  assert.equal(bot.controls.sneak, false);
  assert.deepEqual(bot.lookedAt[0], { x: 0, y: 65.8, z: 4 });
});

test('饱食度不足时不虚报疾跑，但仍朝背离方向前进', () => {
  const bot = fakeBot({ food: 6 });
  assert.equal(sprintAway(bot as never, 1, 0), false);
  assert.equal(bot.controls.forward, true);
  assert.equal(bot.controls.sprint, false);
});

test('零向量不触发转向', () => {
  const bot = fakeBot();
  assert.equal(snapFleeLook(bot as never, 0, 0), false);
  assert.equal(bot.lookedAt.length, 0);
});

test('只有寻路器正在走安全路段时补按疾跑', () => {
  assert.equal(shouldHoldFleeSprint(goodSnapshot), true);
  for (const key of ['pathMoving', 'forward'] as const) {
    assert.equal(shouldHoldFleeSprint({ ...goodSnapshot, [key]: false }), false, key);
  }
  for (const key of ['mining', 'building', 'inWater', 'unsafeGround'] as const) {
    assert.equal(shouldHoldFleeSprint({ ...goodSnapshot, [key]: true }), false, key);
  }
  assert.equal(shouldHoldFleeSprint({ ...goodSnapshot, food: 6 }), false);
});

test('跳跃段不补疾跑:避免每刻 start/stop 抖动', () => {
  // 寻路器 canWalkJump 那支按 jump=true + sprint=false;跟着补 sprint 会与它逐刻互踩
  assert.equal(shouldHoldFleeSprint({ ...goodSnapshot, jump: true }), false);
});

test('视角与 look-smooth 同用 entity.height,不额外低头', () => {
  const bot = fakeBot();
  snapFleeLook(bot as never, 0, 1);
  // 玩家身高 1.8,水平看前方 4 格 → pitch 恰为 0
  const point = bot.lookedAt[0] as { y: number };
  assert.equal(point.y, 64 + 1.8);
});

test('寻路疾跑监听只对当前逃生目标生效，释放后清键', () => {
  const goal = { marker: 'flee' };
  const bot = fakeBot({
    pathfinder: {
      goal,
      isMoving: () => true,
      isMining: () => false,
      isBuilding: () => false,
    },
    blockAt: () => ({ name: 'stone' }),
  });
  bot.controls.forward = true;
  const release = holdFleeSprint(bot as never, goal, () => true);
  assert.equal(bot.listeners.length, 1);
  bot.listeners[0]();
  assert.equal(bot.controls.sprint, true);
  assert.equal(bot.controls.sneak, false);

  bot.controls.sprint = false;
  (bot.pathfinder as { goal?: unknown }).goal = { marker: 'other' };
  bot.listeners[0]();
  assert.equal(bot.controls.sprint, false, '目标换人后不再抢控制键');

  release();
  release();
  assert.equal(bot.listeners.length, 0);
  assert.equal(bot.controls.sprint, false);
});

test('目标被别的任务接管后释放,不打断对方的疾跑', () => {
  const goal = { marker: 'flee' };
  const bot = fakeBot({
    pathfinder: { goal, isMoving: () => true, isMining: () => false, isBuilding: () => false },
    blockAt: () => ({ name: 'stone' }),
  });
  bot.controls.forward = true;
  const release = holdFleeSprint(bot as never, goal, () => true);
  bot.listeners[0]();
  assert.equal(bot.controls.sprint, true);

  // 身体已归下一个任务,它自己也按着疾跑
  (bot.pathfinder as { goal?: unknown }).goal = { marker: 'next' };
  release();
  assert.equal(bot.controls.sprint, true, '不是自己的目标就别清键');
});

test('水中路段留给水中行进控制态，不重复抢疾跑', () => {
  const goal = { marker: 'flee' };
  const bot = fakeBot({
    pathfinder: {
      goal,
      isMoving: () => true,
      isMining: () => false,
      isBuilding: () => false,
    },
    blockAt: () => ({ name: 'water' }),
  });
  bot.entity.isInWater = true;
  bot.controls.forward = true;
  const release = holdFleeSprint(bot as never, goal);
  bot.listeners[0]();
  assert.equal(bot.controls.sprint, undefined);
  release();
});
