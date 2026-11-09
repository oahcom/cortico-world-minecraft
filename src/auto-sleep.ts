/**
 * 自动睡觉:天黑了、手边有床、就躺下。
 *
 * 为什么要有这一层(而不是继续靠提示词说"夜里别出门"):
 *
 * 「夜里别出门」是一条禁令,禁令只能减少出事的次数,不能让她安全地度过夜里。
 * 真正把夜跳过去只有一个动作:睡。而她不会主动睡 —— 2026-11-08 那天,17:23
 * 她睡了一次(因为那单目标里写着"右键床"),之后再没主动睡过,而天黑后到
 * 天亮前那 7 分钟里她死了 9 次。
 *
 * 所以这不是"建议她睡",是反射:入夜 + 床在脚下 + 站着 + 不在挨打 → 躺下。
 * 与防溺水、防岩浆、自动进食同级。决策层该管"今晚干什么",不该管"该不该躺下"。
 *
 * 刻意不做的事:
 *   - 不去找床:床不在这几格就返回 null,让她自己决定要不要走过去。
 *     反射层移动超过 3 格就是在替她做决策了,而且夜里跑去找床本身就是在夜里乱走。
 *   - 不在挨打时睡:原版身边有怪就睡不下去,只会白等 2 秒并卡住反射。
 *   - 不在白天睡:白天睡了纯亏时间,还会把她整个作息推翻。
 */

/** 夜的判定(minecraft timeOfDay):13000 开始暗,23000 开始亮。全仓唯一一份定义 */
export const NIGHT_START = 13_000;
export const NIGHT_END = 23_000;

/** 入夜后等多久才睡。刚入夜那几秒她可能正在收尾一件事,立刻打断得不偿失 */
export const SLEEP_AFTER_NIGHT_START = 500;

/** 床离脚多远以内算"手边"。原版右键距离约 4.5 格,取 3 保守一点 */
export const BED_REACH = 3;

/** 连续睡失败几次就不再试。床被占/旁边有怪时原版会一直失败,不能无限重试 */
export const MAX_SLEEP_FAILURES = 3;

/**
 * 「刚试过,先别急」的时长。
 *
 * 实测必须要有这个:躺下之后 `isSleeping` 不是立刻变 true(服务端回话要几拍),
 * 而 8 秒的节流挡不住 —— 19:00:18 试了一次,19:00:25 又试了一次;19:47 与 20:06
 * 也各重复一次。重复的代价不只是日志刷屏:第一次的 activateBlock 打在旧坐标上
 * (那会儿人刚重生还在传送),会把反射循环和重生抢身体。
 *
 * 90 秒 = 远大于服务端回话 + 一次失败重试,又短于一夜(约 7 分钟)。这样一次成功
 * 躺下之后整夜不会再被喊第二遍,真失败了也还有两三次机会。
 */
export const SLEEP_COOLDOWN_MS = 90_000;

export interface SleepFacts {
  /** 现在的 timeOfDay(0–23999);13000 天黑、23000 天亮 */
  timeOfDay: number;
  /** 附近有没有床,以及它在哪 */
  bed: readonly [number, number, number] | null;
  /** 她脚下 */
  pos: readonly [number, number, number] | null;
  /** 已经在床上(原版 isSleeping) */
  sleeping: boolean;
  /** 身边有敌对生物在追:这时候躺下只会挨打 */
  threatened: boolean;
  /** 这一夜里已经试过几次 */
  failures: number;
  /** 她现在是死的/正在重生 —— 那会儿位置还在传送,对床下动作只会打空 */
  dead?: boolean;
}

/**
 * 现在该不该睡。返回 true = 立刻躺下,不要等她下一轮思考。
 *
 * 全是"能不睡就不睡"的保守判定:宁可少睡一次(她已经会自己找事做),
 * 也不要在一个睡不下去的时刻反复尝试把反射循环堵死。
 */
export function shouldSleep(f: SleepFacts): boolean {
  if (f.sleeping) return false;
  if (f.dead === true) return false;
  if (f.threatened) return false;
  if (f.failures >= MAX_SLEEP_FAILURES) return false;
  if (f.bed === null || f.pos === null) return false;
  // 夜:13000 入夜,23000 天亮。刚入夜留半秒余量。
  if (f.timeOfDay < NIGHT_START + SLEEP_AFTER_NIGHT_START) return false;
  if (f.timeOfDay >= NIGHT_END) return false;
  return horizDist(f.bed, f.pos) <= BED_REACH;
}

/** 与 constraint.ts / world.ts 同一组常量;本文件是唯一定义处,那边从这里取 */

function horizDist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}
