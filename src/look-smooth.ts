/**
 * 视线平滑:把 `bot.lookAt` / `bot.look` 从"瞬拧"改成"设目标 + 每物理刻转一点"。
 *
 * 观众看的 CortiCam 是旁观 bot 的第一人称,看到的就是实体 yaw/pitch 的原样快照。
 * 路径重算、寻路器逐 tick 朝下一路点、多套动作抢视线,在第一人称里就是镜头左右甩。
 * 这里统一收口:**所有 look 调用只设目标**,每 tick 只写一次原始 look,转角有上限,
 * 目标抖动有死区。`lookAt` 返回的 Promise 在转到位(或 200ms 兜底)时兑现,
 * 所以 `await lookAt(...)` 之后立刻挖掘/放置的既有语义不变。
 *
 * 装在寻路器与踩水之后:同一个物理刻里后注册的监听说了算。
 */
import type { Bot } from 'mineflayer';

/** 目标变化小于这个弧度不重设:滤掉两套逻辑来回抢造成的原地抖动(约 3.4°)。 */
const DEADZONE_RAD = 0.06;
/** 每物理刻最大水平转角(约 12.6°/刻,250°/s):够快,但观众看到的是转不是瞬拧。 */
const MAX_STEP_RAD = 0.22;
/** 每物理刻最大俯仰转角。 */
const MAX_PITCH_STEP_RAD = 0.16;
/** 到位判据;`lookAt` 的 await 在这里兑现。 */
const SETTLE_RAD = 0.02;
/** 兜底:await 最多等这么久就兑现,免得调用方卡死(如目标持续移动)。 */
const PENDING_TIMEOUT_MS = 200;
/** 待兑现队列上限:寻路器每刻都可能发起一次且不等结果,防止无限堆。 */
const PENDING_MAX = 24;

interface LookState {
  targetYaw: number;
  targetPitch: number;
  pending: Array<{ at: number; resolve: () => void }>;
  /** 原始写包:只在本模块的每刻步进与 snap 旁路里用 */
  write: (yaw: number, pitch: number) => void;
}

const states = new WeakMap<object, LookState>();

/** 把角度差折进 (-π, π]。 */
function wrap(d: number): number {
  let x = d;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

function clampPitch(p: number): number {
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p));
}

function settle(st: LookState): void {
  const waiting = st.pending;
  st.pending = [];
  for (const p of waiting) p.resolve();
}

/** 眼睛到目标点的 yaw/pitch(与 mineflayer lookAt 同一套算法)。 */
function anglesTo(bot: Bot, point: { x: number; y: number; z: number }): { yaw: number; pitch: number } {
  const eye = bot.entity.position.offset(0, bot.entity.height ?? 1.62, 0);
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  const ground = Math.sqrt(dx * dx + dz * dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, ground) };
}

/**
 * 立刻转过去并写包,不走步进。挥刀、放箭、撤离转向这类"同一个刻里服务端就要
 * 看到新朝向"的动作走这里;平滑只服务观感,不能让判定落空。
 */
export function snapLookAt(bot: Bot, point: { x: number; y: number; z: number }): void {
  const st = states.get(bot);
  if (!st) {
    void bot.lookAt(point as never, true).catch(() => undefined);
    return;
  }
  const { yaw, pitch } = anglesTo(bot, point);
  st.targetYaw = yaw;
  st.targetPitch = clampPitch(pitch);
  st.write(st.targetYaw, st.targetPitch);
  settle(st);
}

/** 这一台 bot 装过没有(重复 install 时直接跳过)。 */
export function hasLookSmoothing(bot: Bot): boolean {
  return states.has(bot);
}

export function installLookSmoothing(bot: Bot): void {
  if (states.has(bot) || !bot.entity) return;

  const rawLook = bot.look.bind(bot);
  const write = (yaw: number, pitch: number): void => {
    void rawLook(yaw, pitch, true).catch(() => undefined);
  };
  const state: LookState = {
    targetYaw: bot.entity.yaw,
    targetPitch: bot.entity.pitch,
    pending: [],
    write,
  };
  states.set(bot, state);

  const setTarget = (yaw: number, pitch: number): Promise<void> => {
    const delta = wrap(yaw - state.targetYaw);
    if (Math.abs(delta) > DEADZONE_RAD) state.targetYaw = wrap(state.targetYaw + delta);
    state.targetPitch = clampPitch(pitch);

    const near = Math.abs(wrap(state.targetYaw - bot.entity.yaw)) < SETTLE_RAD
      && Math.abs(state.targetPitch - bot.entity.pitch) < SETTLE_RAD;
    if (near) {
      // 已经在位:照旧写一次包,行为与未平滑时一致
      write(state.targetYaw, state.targetPitch);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      state.pending.push({ at: Date.now(), resolve });
      if (state.pending.length > PENDING_MAX) {
        const oldest = state.pending.shift();
        oldest?.resolve();
      }
    });
  };

  bot.look = ((yaw: number, pitch: number, _force?: boolean): Promise<void> =>
    setTarget(yaw, pitch)) as typeof bot.look;

  bot.lookAt = ((point: { x: number; y: number; z: number }, _force?: boolean): Promise<void> => {
    const { yaw, pitch } = anglesTo(bot, point);
    return setTarget(yaw, pitch);
  }) as typeof bot.lookAt;

  bot.on('physicsTick', () => {
    const now = Date.now();
    const yawNow = bot.entity.yaw;
    const pitchNow = bot.entity.pitch;
    const dy = wrap(state.targetYaw - yawNow);
    const dp = state.targetPitch - pitchNow;

    const nextYaw = Math.abs(dy) <= MAX_STEP_RAD ? state.targetYaw : wrap(yawNow + Math.sign(dy) * MAX_STEP_RAD);
    const nextPitch = Math.abs(dp) <= MAX_PITCH_STEP_RAD
      ? state.targetPitch
      : pitchNow + Math.sign(dp) * MAX_PITCH_STEP_RAD;

    const settled = Math.abs(wrap(state.targetYaw - nextYaw)) < SETTLE_RAD
      && Math.abs(state.targetPitch - nextPitch) < SETTLE_RAD;
    const changed = Math.abs(wrap(nextYaw - yawNow)) > 1e-4
      || Math.abs(nextPitch - pitchNow) > 1e-4;
    // 只在真的转了才发包;到位后不必每刻重发同一个朝向
    if (changed) write(nextYaw, nextPitch);
    if (settled) {
      settle(state);
      return;
    }
    // 超时兜底:持续移动的目标也不能让 await 卡住调用方
    if (state.pending.length > 0) {
      const keep: LookState['pending'] = [];
      for (const p of state.pending) {
        if (now - p.at >= PENDING_TIMEOUT_MS) p.resolve();
        else keep.push(p);
      }
      state.pending = keep;
    }
  });
}
