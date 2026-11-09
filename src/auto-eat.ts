/**
 * 自动进食:饥饿掉到线以下,不等她想起来就吃。
 *
 * 为什么要有这一层(而不是继续靠提示词让她"记得吃"):
 *
 * 回血只有一条路 —— 饥饿 ≥18 时每 4 秒回 1 点。所以她能不能活,取决于她
 * **有没有在饥饿跌破 18 的那一刻想起来吃**。而这是个纯记忆负担:每轮思考都要
 * 自己记得,忘了就一路掉到 17(回血通道关闭)、再掉到 6(不能疾跑)。
 * 实测 2026-11-08 一天 19 次死亡,15 次死于战斗 —— 每一次都是"没回血就接着打"。
 *
 * 这不是决策,是反射:和防溺水、防岩浆同级。决策层该管的是"往哪走、打不打",
 * 不该管"血条下面那排鸡腿还剩几格"。
 *
 * 刻意不做的事:
 *   - 不吃毒食(河豚/蜘蛛眼/毒马铃薯),宁可饿着也不掉血
 *   - 不在饿到 6 以下时还挑三拣四:那时候能吃的都吃
 *   - 不碰金苹果:那是打 Boss 的资源,不是口粮
 */

/** 到这个饥饿值就该吃了。原版 18 以上才回血,留 2 点余量给"吃一口要 1.6 秒" */
export const EAT_BELOW = 16;

/** 吃饱到这个值就停。与回血门槛 18 同一根线,不多吃 */
export const EAT_UNTIL = 18;

/** 紧急线:到这还挑食就是等死 */
export const EAT_URGENT_BELOW = 7;

/** 不当口粮的东西:毒食、金苹果、以及只能酿药的 */
const NOT_MEAL: ReadonlySet<string> = new Set([
  'pufferfish', 'spider_eye', 'poisonous_potato',
  'golden_apple', 'enchanted_golden_apple',
  'golden_carrot',
]);

export interface FoodPick {
  name: string;
  count: number;
  /** 吃这一口能回多少饥饿点(minecraft-data 的 foodPoints);读不到是 0 */
  points: number;
}

/**
 * 从背包里挑一样该吃的。
 *
 * 顺序:**先吃快坏的、再吃回得多的**。快坏的是腐肉、生鱼这类 —— 它们占格子且
 * 越放越没用;回得多的留到真需要的时候。急线以下不看这个,谁回得多吃谁。
 *
 * 返回 null = 没有可吃的(那就只能去弄吃的,不是这里能解决的)。
 */
export function pickMeal(
  items: readonly FoodPick[],
  food: number,
  isPoisonous: (name: string) => boolean = (n) => NOT_MEAL.has(n),
): FoodPick | null {
  if (food >= EAT_BELOW) return null;
  const urgent = food <= EAT_URGENT_BELOW;
  const usable = items.filter((i) => i.count > 0 && i.points > 0 && !isPoisonous(i.name));
  if (usable.length === 0) return null;
  // 急线以下:回得最多的优先,别管浪不浪费
  if (urgent) return usable.reduce((a, b) => (b.points > a.points ? b : a));
  // 平时:回得少的先吃(腐肉、生鱼、甜菜根),把好口粮留着
  return usable.reduce((a, b) => (b.points < a.points ? b : a));
}

/**
 * 这一口吃完会不会超过 EAT_UNTIL 太多。
 *
 * 原版吃东西是一口一个、每口固定回 foodPoints,不能吃半个。所以"吃饱了"的判定
 * 只能是"再吃一口就浪费了":留着那口给下一顿,比现在硬塞进去好。
 * 但饿的时候(≤EAT_URGENT_BELOW)不适用 —— 那时候先活下来再说。
 */
export function worthEating(food: number, points: number): boolean {
  if (food >= EAT_BELOW) return false;
  if (food <= EAT_URGENT_BELOW) return true;
  return food + points <= 20;
}
