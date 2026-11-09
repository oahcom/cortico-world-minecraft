/**
 * 逃生疾跑：把「这一拍就按正前方疾跑」与「寻路途中持续保住疾跑」收在一处。
 *
 * 手动撤退按世界方向选好背离点后，必须先把镜头同步转到跑的方向，再按 forward；
 * 原版只有前进时才起得起疾跑。若镜头还在平滑转向中，按同一方向算出的相对按键是
 * back，疾跑条件也永远不成立。寻路器接管后，它会在每个物理刻按路线估值重写
 * sprint，所以逃生期间还要有一个后注册的监听，在安全的移动段把疾跑补回去。
 */
import type { Bot } from 'mineflayer';
import { snapLookAt } from './look-smooth.ts';

/** 镜头目标放在身体前方 4 格、眼高处；只为算 yaw/pitch，不要求方块可读。 */
const LOOK_AHEAD_BLOCKS = 4;
/**
 * 与 look-smooth 的 anglesTo 取同一字段（`bot.entity.height`，玩家 1.8）。
 * 换成 1.62 会让 pitch 偏下约 2.6°，疾跑步该是平视。
 */
const DEFAULT_EYE_HEIGHT = 1.8;
/** 原版饱食度 6 及以下不能疾跑；读不到读数时按可疾跑处理。 */
const MIN_SPRINT_FOOD = 7;

/** 水中交给 water-travel 的专用控制态；岩浆、火和减速地面不强行加速。 */
const UNSAFE_SPRINT_GROUND = new Set([
  'water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass',
  'lava', 'magma_block', 'fire', 'soul_fire', 'campfire', 'soul_campfire',
  'cactus', 'sweet_berry_bush', 'powder_snow',
]);

interface PathfinderLike {
  goal?: unknown;
  isMoving?: () => boolean;
  isMining?: () => boolean;
  isBuilding?: () => boolean;
}

export interface FleeSprintSnapshot {
  pathMoving: boolean;
  mining: boolean;
  building: boolean;
  forward: boolean;
  jump: boolean;
  inWater: boolean;
  unsafeGround: boolean;
  food: number;
}

/** 把世界方向立刻写进 bot 的 yaw/pitch；无效方向返回 false。 */
export function snapFleeLook(bot: Bot, dx: number, dz: number): boolean {
  if (!bot.entity) return false;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const p = bot.entity.position;
  const eye = (bot.entity as unknown as { height?: number }).height ?? DEFAULT_EYE_HEIGHT;
  snapLookAt(bot, {
    x: p.x + (dx / len) * LOOK_AHEAD_BLOCKS,
    y: p.y + eye,
    z: p.z + (dz / len) * LOOK_AHEAD_BLOCKS,
  });
  return true;
}

/**
 * 手动撤退的一步：同步转向、清掉会拖慢速度的键、正前 + 疾跑一起按。
 * 返回游戏当前是否允许疾跑；饱食度不足时仍会前进，但不虚报已加速。
 */
export function sprintAway(bot: Bot, dx: number, dz: number): boolean {
  if (!snapFleeLook(bot, dx, dz)) return false;
  for (const key of ['back', 'left', 'right', 'sneak'] as const) {
    bot.setControlState(key, false);
  }
  bot.setControlState('forward', true);
  const canSprint = (bot.food ?? 20) >= MIN_SPRINT_FOOD;
  bot.setControlState('sprint', canSprint);
  return canSprint;
}

/**
 * 只在寻路器正在走平坦直路、脚下安全、饱食度够时补按疾跑。
 *
 * `jump` 是分界线(见 mineflayer-pathfinder index.js 的 monitorMovement):
 * `canStraightLine` 那支是 jump=false + sprint=false,补 sprint 正好补上它保守丢掉的那档;
 * `canWalkJump` 那支是 jump=true + sprint=false —— 跳跃段本来就该走,跟着补 sprint
 * 会每个物理刻把 stop_sprinting/start_sprinting 轮流发一遍,服务端视场角跟着抖。
 */
export function shouldHoldFleeSprint(s: FleeSprintSnapshot): boolean {
  return s.pathMoving
    && !s.mining
    && !s.building
    && s.forward
    && !s.jump
    && !s.inWater
    && !s.unsafeGround
    && s.food >= MIN_SPRINT_FOOD;
}

/** 读这一物理刻的控制态；bot.pathfinder 的可选诊断方法用鸭子类型兜住版本差异。 */
export function readFleeSprintSnapshot(bot: Bot): FleeSprintSnapshot {
  const pf = (bot as unknown as { pathfinder?: PathfinderLike }).pathfinder;
  const entity = bot.entity as unknown as { isInWater?: boolean } | undefined;
  const feet = bot.entity ? bot.blockAt(bot.entity.position) : null;
  const ground = feet?.name ?? '';
  return {
    pathMoving: Boolean(pf?.isMoving?.()),
    mining: Boolean(pf?.isMining?.()),
    building: Boolean(pf?.isBuilding?.()),
    forward: Boolean(bot.getControlState?.('forward')),
    jump: Boolean(bot.getControlState?.('jump')),
    inWater: Boolean(entity?.isInWater) || ground === 'water',
    unsafeGround: UNSAFE_SPRINT_GROUND.has(ground),
    food: bot.food ?? 20,
  };
}

/**
 * 逃生寻路期间持续保住疾跑。监听在任务发起时注册，排在 pathfinder、踩水、
 * 水中行进和视线平滑之后，因而能在它们写完控制键的同一物理刻补上 sprint。
 * 目标被别的任务换掉、任务中止或调用 release 后立即退出，不污染后续动作。
 */
export function holdFleeSprint(
  bot: Bot,
  goal: unknown,
  active: () => boolean = () => true,
): () => void {
  let released = false;
  const onTick = (): void => {
    if (released || !active() || !bot.entity) return;
    const pf = (bot as unknown as { pathfinder?: PathfinderLike }).pathfinder;
    if (!pf || pf.goal !== goal) return;
    if (!shouldHoldFleeSprint(readFleeSprintSnapshot(bot))) return;
    bot.setControlState('sneak', false);
    bot.setControlState('sprint', true);
  };
  bot.on('physicsTick', onTick);
  return (): void => {
    if (released) return;
    released = true;
    bot.removeListener('physicsTick', onTick);
    // 目标已被别的任务换掉时身体归它:这一下清 sprint 会把它的疾跑打断半秒
    const pf = (bot as unknown as { pathfinder?: PathfinderLike }).pathfinder;
    if (!pf || pf.goal === goal) bot.setControlState('sprint', false);
  };
}
