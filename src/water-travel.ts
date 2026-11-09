/**
 * 水中行进:泡在水里要过河、要逆流上去时,寻路器会逐刻松键(到站/算路/停下来挖放),
 * 疾跑又被 `suppressSprintNearWater` 按下 40 tick。观众看到的就是"点按前进、没有加速、
 * 逆流走不出去"。这里在物理刻上补一套"持续按住":
 *
 * - 在水里且寻路器正在走 → `forward` 按住不放,直到上岸或寻路停下;
 * - 头没进水里/目标在上方 → 按住 `jump`(原版不按跳会下沉,逆流靠它上浮);
 *   目标明显在下方时不按,免得和往下的路点打架(travel.ts 的踩水监听同一套道理);
 * - 有饱食度且要给速度 → 按住 `sprint`,并通过 `shouldSprintInWater` 给桥的抑速开豁免。
 *
 * 只在"寻路器正在走"时接管,挖矿/放置/战斗一律不碰。装在踩水之后。
 */
import type { Bot } from 'mineflayer';
// 只为类型增强(bot.pathfinder 由 pathfinder 插件声明),不产生运行时依赖
import type {} from 'mineflayer-pathfinder';

const WATER_BLOCKS = new Set([
  'water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass',
]);

/** 泡水判定的余量 tick:离开水面后仍按几刻,避免岸边逐刻抖动。 */
const WET_TICKS = 8;
/** 低于这个饱食度不疾跑(原版 6 以下不能疾跑)。 */
const MIN_FOOD = 7;

const wetTicks = new WeakMap<object, number>();
const assisted = new WeakMap<object, boolean>();

function inWater(bot: Bot): boolean {
  const ent = bot.entity as unknown as { isInWater?: boolean };
  if (ent?.isInWater) return true;
  const feet = bot.blockAt(bot.entity.position);
  return feet !== null && WATER_BLOCKS.has(feet.name);
}

function headInWater(bot: Bot): boolean {
  const head = bot.blockAt(bot.entity.position.offset(0, 1.5, 0));
  return head !== null && WATER_BLOCKS.has(head.name);
}

/** 目标那一格的 y(GoalNearXZ 这类没有 y 的目标返回 null)。 */
function goalY(bot: Bot): number | null {
  const goal = bot.pathfinder?.goal as { y?: unknown } | null | undefined;
  return goal && typeof goal.y === 'number' ? goal.y : null;
}

/**
 * 桥在禁疾跑前问这一句:水里正在赶路、且还有饱食度时放行疾跑。
 * 水面抖动仍由 40 tick 的抑速兜住,只是"走路"这一件事有豁免。
 */
export function shouldSprintInWater(bot: Bot): boolean {
  if ((wetTicks.get(bot) ?? 0) <= 0) return false;
  if (!bot.pathfinder?.isMoving()) return false;
  return (bot.food ?? 20) >= MIN_FOOD;
}

/** 这一台 bot 是不是正被水中行进接管(供调试/回执用)。 */
export function waterAssistActive(bot: Bot): boolean {
  return assisted.get(bot) === true;
}

export function installWaterTravel(bot: Bot): void {
  bot.on('physicsTick', () => {
    const wetNow = inWater(bot);
    const wet = wetNow ? WET_TICKS : Math.max(0, (wetTicks.get(bot) ?? 0) - 1);
    wetTicks.set(bot, wet);

    const moving = Boolean(bot.pathfinder?.isMoving());
    const assist = wet > 0 && moving;
    assisted.set(bot, assist);
    if (!assist) return;

    bot.setControlState('forward', true);

    const gy = goalY(bot);
    const feetY = Math.floor(bot.entity.position.y);
    const wantUp = headInWater(bot) || (gy !== null && gy > feetY + 1);
    const wantDown = gy !== null && gy < feetY - 1;
    bot.setControlState('jump', wantUp && !wantDown);

    const canSprint = (bot.food ?? 20) >= MIN_FOOD;
    if (canSprint) bot.setControlState('sprint', true);
  });
}
