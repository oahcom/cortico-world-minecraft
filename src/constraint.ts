/**
 * 约束面:她和世界之间那条"这一段时间不许做什么"的契约。
 *
 * 为什么要有这个文件(而不是继续在 executor 里堆拒单分支):
 *
 * 旧的生存闸是一堆散装 if —— 低血拦打怪、夜里拦出门、饿着拦重活,每条都自带
 * 一套"先警告、重发即放行"的确认槽。它有三个结构性毛病:
 *
 *   1. 约束没有住址。它只活在某个变量的一个确认槽里,不进快照、不进注意力清单,
 *      于是下一轮思考看不见它 —— 用户看到的"目标丢失"就是这么来的。
 *   2. 解除条件是"模型把同一单再下一次"。那等于把"想出门"本身变成通行证,
 *      而它真正该等的是世界事实(天亮、有床、血回来)。
 *   3. 拦的是整单,不是违规的那一步。人一旦被整单拒掉,就不会再想"我还能干点别的"。
 *
 * 所以这里把"约束"抽成一个对象:作用域靠世界事实算,禁止集是一小组固定词,
 * 解除条件只有世界事实或显式越权两条路。**约束只禁止违反它的动作,不禁止一切** ——
 * 洞里照样能挖矿、烧煤、做东西吃,这也是用户的原话。
 *
 * 本文件是纯函数,不 import 世界包里的任何东西:好测,也好在没有 bot 的环境里跑。
 */

/** 约束生效与否要看的那些世界事实。全部来自 World,不让这里自己读 bot */
export interface ConstraintFacts {
  /** 现在是夜里(minecraft timeOfDay ∈ [13000, 23000)) */
  night: boolean;
  /** 有多人重生点(床/重生锚) */
  hasSpawn: boolean;
  health: number;
  food: number;
  /** 包里有没有能吃且不毒的东西 */
  hasMeal: boolean;
  /** 今天已经死了几次 */
  todayDeaths: number;
  /** 她自己站的位置;没连上是 null */
  pos: readonly [number, number, number] | null;
  /**
   * 她现在是不是泡在水里(或水下)。
   *
   * 为什么要单独一个事实:提示词里「不在水里追鱼」写了 41 行,实测照追不误 ——
   * 2026-11-09 半天日志里 `attack cod/salmon` 命中 100 次,「16 格内没有能站的岸」20 次,
   * 溺死 5 次(其中 14:29 那次是当天第 10 条命)。这不是不懂,是水下的鱼太近、
   * 而"下水一步就能打到"永远比"回岸上换钓鱼竿"显得便宜。劝告赢不了这个成本差,只能机械拦。
   */
  inWater: boolean;
  /** 庇护点(床/重生锚)的坐标;没有是 null */
  shelter: readonly [number, number, number] | null;
  /**
   * 她自己在地图上记过的床(或家)的坐标;没有是 null。
   *
   * 与 shelter 分开是 2026-11-09 实测逼出来的:重生点是内存态,每次重连都被清空
   * (`setPersonalSpawn(null, '重连,基线作废')`),而 external 服务器模式下
   * `hydratePersonalSpawn` 直接 return —— 于是 shelter 恒为 null,`movesTowardShelter`
   * 恒返回 false,「往家走永远放行」这条规则在她身上从未生效过。
   *
   * 现场证据:14:21 她离家 120 格、没有重生点、天黑了,想 goto 回床。
   * trip:night 拦 ≥24 格(没有 shelter 就没有回家的例外),no-spawn-far 拦 ≥96 格。
   * 她越权放行了 no-spawn-far,轮到这一步时又被 trip:night 拦掉 —— 任务#7 原地空转。
   * 路标表里那张床一直好好的,系统只是不知道"家在哪"。
   */
  bedPos: readonly [number, number, number] | null;
  /** 离天亮还有几分钟(游戏内时间折算);不是夜里是 null */
  minutesToDawn: number | null;
}

/**
 * 禁止集的词汇表。**固定枚举,不是自由文本** —— 自由文本拦不住任何东西。
 *
 * 每一格都对应"受理刻就能从 SkillCall 里判出来"的一个事实。判不出来的动作
 * 一律不在这张表里,也就一律放行:这就是"只禁止违反它的动作"的落法。
 */
export type ForbidCode =
  /** 走远:find 带方向且 distance ≥ 64(行军性质,走满一程回来很难) */
  | 'trip:far'
  /**
   * 走很远:≥96 格,没有重生点那一档。
   *
   * 和 trip:far 分开是实测逼出来的:首版让「没有重生点」也拦 64 格,
   * 结果她要去剪羊毛做床,而**床正是解除这条约束的唯一办法** —— 模型自己在
   * 越权理由里写「原地不动就永远解不了」。约束不许把解除自己的路堵死。
   */
  | 'trip:lone'
  /** 下挖:excavate/tunnel 的绝对锚点最低 y ≤ 20(死在那儿要重走很远) */
  | 'dig:down'
  /** 打会还手的:attack 且目标在 HOSTILE_MOBS 里。打牛打鱼是找吃的,不算 */
  | 'fight:hostile'
  /** 费体力的活:excavate/tunnel/build/smelt/brew/enchant */
  | 'work:hard'
  /** 离开庇护点 24 格以上(没有庇护点时不判) */
  | 'leave:shelter'
  /**
   * 夜里的出行:带方向的 find(任意距离)、goto/travel 离自己 ≥24 格。
   *
   * 为什么单开一格而不是靠 leave:shelter:那一格要先有庇护点才算数。
   * 实测 2026-11-08 22:44 她死时**没有重生点**(shelter=null),于是整条夜闸
   * 对"出门"完全不判 —— 23:07 她在夜里往东走了 33 格去找牛,正是这一格漏的。
   * 夜里的危险来自"离开脚下这一小块",与有没有床无关。
   */
  | 'trip:night'
  /** 上到见天的地表(目标 y ≥ 62) */
  | 'surface:open'
  /**
   * 采集木石(非食物)。
   *
   * 为什么单开一格:starving 只拦 work:hard,而 collect 不在里面 —— 2026-11-09
   * 11:44–13:11 她饥饿 0/20 连续一个半小时砍了三轮橡木(任务#72 等),期间摔死一次。
   * 饥饿 0 没有回血通道,砍树换不来这一顿,只花掉最后的体力。打猎/钓鱼/摘浆果
   * 才是找吃的,所以只拦木石这一类。
   */
  | 'gather:raw'
  /**
   * 下水:血不满时主动进水里干活。
   *
   * 单独开一格而不是并进 fight:hostile:水下的危险不是"会还手的怪",
   * 是"没有掩体 + 15 秒氧气 + 被水流推着走"。2026-11-09 五次溺死里有四次
   * 死因写的是 `drowned`,而当时血线并不低 —— 低血闸一次都没管到这件事。
   */
  | 'enter:water';

export interface ForbidSpec {
  code: ForbidCode;
  /** 回执和快照里念的那几个字 */
  zh: string;
  /** 为什么这一类会被拦(只有越权回执需要,平时不念) */
  why: string;
}

export const FORBID_VOCAB: Readonly<Record<ForbidCode, ForbidSpec>> = {
  'trip:far': { code: 'trip:far', zh: '走远', why: '走满一程回不来,而这一趟换不回命' },
  'trip:lone': { code: 'trip:lone', zh: '走很远', why: '没有重生点还走这么远,死了要从世界出生点跑回来' },
  'dig:down': { code: 'dig:down', zh: '下挖', why: '下去容易上来难,死在下头要重走很远' },
  'fight:hostile': { code: 'fight:hostile', zh: '打会还手的', why: '这个状态下打不赢,而且跑不掉' },
  'work:hard': { code: 'work:hard', zh: '费体力的活', why: '饿着/血少的时候干这个只会更快见底' },
  'leave:shelter': { code: 'leave:shelter', zh: '离开庇护点', why: '出了这道门就没有墙替你挡了' },
  'trip:night': { code: 'trip:night', zh: '夜里出行', why: '夜里在露天的每一步都是在给骷髅和僵尸送人头' },
  'surface:open': { code: 'surface:open', zh: '上地表', why: '露天的地方现在全是怪' },
  'gather:raw': { code: 'gather:raw', zh: '砍树挖石', why: '没饭吃的时候砍树挖石换不来这一顿,只花掉最后的体力' },
  'enter:water': { code: 'enter:water', zh: '下水干活', why: '水里没有掩体,氧气 15 秒就见底,被水流推着走时游不回来' },
};

const FORBID_CODES = Object.keys(FORBID_VOCAB) as ForbidCode[];

/** 认不出就返回 null,由调用方把原文丢回去让她改 —— 绝不悄悄当成"全放行" */
export function parseForbid(raw: unknown): ForbidCode | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return (FORBID_CODES as string[]).includes(t) ? (t as ForbidCode) : null;
}

/**
 * 会还手的那些。旧闸踩过的坑写在注释里,别重犯:首版把 attack 整类都拦了,
 * 结果 18:09–18:16 连拦 9 次,每次目标都是 salmon —— 她正靠打鱼活命,
 * 闸门却在堵她唯一的活路。打鱼是找吃的,不是打架。
 */
const HOSTILE_MOBS: ReadonlySet<string> = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'wither_skeleton',
  'creeper', 'spider', 'cave_spider', 'silverfish', 'endermite', 'slime', 'magma_cube',
  'enderman', 'witch', 'pillager', 'vindicator', 'evoker', 'illusioner', 'ravager', 'vex', 'shulker',
  'phantom', 'blaze', 'ghast', 'hoglin', 'zoglin', 'piglin_brute', 'zombified_piglin', 'warden',
  'guardian', 'elder_guardian', 'breeze', 'wither', 'ender_dragon',
]);

/** 费体力的那几个技能 */
const HARD_WORK: ReadonlySet<string> = new Set(['excavate', 'tunnel', 'build', 'smelt', 'brew', 'enchant']);

/**
 * 木石类原料:砍树、挖石这类"换不来这一顿"的活。
 *
 * 只列非食物。`_log` 覆盖 oak_log/spruce_log/…,`_ore` 覆盖各类矿石,
 * 剩下的逐个点名 —— 宁可漏一个(放行一次),也不要把浆果/作物误拦进来。
 */
const RAW_MATERIALS: readonly string[] = [
  '_log', '_wood', '_planks', 'cobblestone', 'stone', 'deepslate', 'andesite', 'diorite', 'granite',
  'tuff', 'calcite', 'gravel', 'sand', 'sandstone', 'dirt', 'clay', '_ore', 'coal', 'iron_ingot',
  'raw_iron', 'raw_copper', 'raw_gold', 'flint', 'obsidian',
];

/** 走这么远的 find 算行军 */
const MARCH_FAR_BLOCKS = 64;
/** 没有重生点还走这么远,等于把命押在一趟回不来的路上 */
const MARCH_LONE_BLOCKS = 96;
/** 低于这个高度算"下潜"。取 20 不是 40:她的工作面就在 y≈36,取 40 会把每次常规挖矿都判成下潜 */
const DESCENT_Y = 20;
/** 离开庇护点这么远就算出门 */
const SHELTER_RADIUS = 24;
/**
 * 夜里走到这么远就算"出行"。
 *
 * 与 SHELTER_RADIUS 同值不是巧合:夜里"能去的地方"就是庇护点那一圈。取 24 而不是 0,
 * 是因为洞里横着走两步去接水/捡掉落物不该被拒;取 24 而不是 64,是因为 2026-11-08
 * 夜里那 9 次死亡的死亡点离床 20–56 格 —— 64 的门槛一次都没拦住。
 */
const NIGHT_TRIP_BLOCKS = 24;
/** 这一高度以上算见天 */
const SURFACE_Y = 62;
/**
 * 就地动手的半径:这个圈内的 build/tunnel/excavate 都算"在原地干活",不算出门。
 *
 * 2026-11-09 12:34 实测:她离家 30 格,天黑了,想背靠土坡挖两格把自己封起来,
 * 结果 leave:shelter 判的是"目标点离床 ≥24 格" —— 她脚下那一点本来就离床 30 格,
 * 于是"就地封闭"这个唯一正确的动作被夜闸自己拒了 6 次(12:34:20/29/37/42/52/58)。
 * 约束把解除自己的路堵死,这是第二次(第一次是床)。
 */
const IN_PLACE_RADIUS = 6;

/** 这一步的落点是不是「在原地动手」:所有可达点都在她脚下 IN_PLACE_RADIUS 以内 */
function staysInPlace(step: StepView, facts: ConstraintFacts): boolean {
  if (facts.pos === null) return false;
  const points = reachPoints(step);
  if (points.length === 0) return false;
  return points.every((p) => horizDist(p, facts.pos as readonly [number, number, number]) <= IN_PLACE_RADIUS);
}

/**
 * 她的"家"在哪:优先重生点,没有就用路标表里记的床。
 *
 * 后者不是备份手段,是唯一稳的那个 —— 重生点是内存态,重连就没了(见 ConstraintFacts.bedPos)。
 */
function homeOf(facts: ConstraintFacts): readonly [number, number, number] | null {
  return facts.shelter ?? facts.bedPos ?? null;
}

/**
 * 这一步最远会把她带到哪(离她现在多少格);算不出来返回 null。
 *
 * **不只 goto**:任何带 `at` 的技能都要先走过去。2026-11-09 14:28 的实证 ——
 * 任务#4 第 1 步 `goto 家` 被 trip:lone 拦下,执行器还把第 2 步 `use at=同一个家`
 * 念成「不违规,可以拆出来先做」。她照做,朝 133 格外的家走,一路垫橡木木板把
 * 自己闷进方块里、脚下又是水,窒息 + 溺水,39 秒后死在 (-57,61,19)。
 * 约束只管 goto 就等于不管她怎么走 —— 只禁止违反它的动作,不等于只禁止说得出口的那一个。
 */
function tripDistance(step: StepView, facts: ConstraintFacts): number | null {
  if (facts.pos === null) return null;
  // 相对锚点(~)到做那一刻才知道;带方向的 find 由 distance 参数说,另判
  let far: number | null = null;
  for (const p of reachPoints(step)) {
    const d = horizDist(p, facts.pos);
    far = far === null ? d : Math.max(far, d);
  }
  return far;
}

/**
 * 这一步是不是「走得回家」:落点就在家那一圈里。
 *
 * 判的是"到不到家",不是"比现在近一点" —— 后者会把 (0,60,-200) 这种
 * 离家 115 格的海上过路点也放行,她照样是孤身在外。回家只需要一条 goto
 * 直接落在床边,不需要中间站。
 *
 * 不认技能名:回家之后还得右键点床 / 放方块 / 躺下,那些步也是回家。
 * 要求所有落点都在圈内 —— 一块跑偏的蓝图不算回家。
 */
function movesTowardShelter(step: StepView, facts: ConstraintFacts): boolean {
  const home = homeOf(facts);
  if (home === null) return false;
  const points = reachPoints(step);
  if (points.length === 0) return false;
  return points.every((p) => horizDist(p, home) <= SHELTER_RADIUS);
}

/** 受理刻能拿到的那些技能参数。故意用一个宽松的视图,不 import SkillCall —— 免得反向依赖 */
interface StepView {
  skill?: unknown;
  direction?: unknown;
  distance?: unknown;
  at?: unknown;
  anchors?: unknown;
  /** build 的贴面形态:落点在 on[].at 里 */
  on?: unknown;
  target?: unknown;
  item?: unknown;
  block?: unknown;
}

function vec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [x, y, z] = v;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  return [x, y, z];
}

/** 这一步里能算出来的最低绝对 y:只认绝对锚点,相对锚点(~)到做那一刻才知道 */
function lowestY(step: StepView): number | null {
  let low: number | null = null;
  const take = (v: unknown): void => {
    const p = vec3(v);
    if (!p) return;
    low = low === null ? p[1] : Math.min(low, p[1]);
  };
  take(step.at);
  if (Array.isArray(step.anchors)) for (const a of step.anchors) take(a);
  return low;
}

/** 这一步要去的最远/最高点:给 leave:shelter 和 surface:open 用 */
function reachPoints(step: StepView): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  const one = vec3(step.at);
  if (one) out.push(one);
  if (Array.isArray(step.anchors)) {
    for (const a of step.anchors) {
      const p = vec3(a);
      if (p) out.push(p);
    }
  }
  // build 的贴面形态把落点放在 on[] 里,顶层没有 at —— 漏掉它等于
  // 「贴着别的格放方块」这一整类走远路都不受约束管(2026-11-09 14:28 那单就是
  // 边走边放置闷死自己的)。
  if (Array.isArray(step.on)) {
    for (const o of step.on) {
      if (o !== null && typeof o === 'object') {
        const p = vec3((o as { at?: unknown }).at);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

function horizDist(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/**
 * 这一步有没有违反某一类禁止。
 *
 * 判不出来的(相对锚点、缺字段、参数怪)一律返回 false —— **约束不许成为第二个故障源**。
 * 宁可放行一次,也不要在受理刻抛异常把整单卡死。
 */
export function stepViolates(code: ForbidCode, raw: unknown, facts: ConstraintFacts): boolean {
  const step = (raw ?? {}) as StepView;
  const skill = typeof step.skill === 'string' ? step.skill : '';
  switch (code) {
    case 'trip:far': {
      if (skill === 'find' && typeof step.direction === 'string') {
        return typeof step.distance === 'number' && step.distance >= MARCH_FAR_BLOCKS;
      }
      // 任何带绝对落点的技能都算:走过去的那段路才是风险,技能叫什么名字无所谓
      const far = tripDistance(step, facts);
      return far !== null && far >= MARCH_FAR_BLOCKS;
    }
    case 'trip:lone': {
      // 回家放行:这条约束的目的是"别把命押在回不来的路上",往回走正好相反。
      // 2026-11-09 14:21 现场就是这么锁死的:她离家 120 格、没有重生点,
      // goto 回床被判 trip:lone,越权放行后到步边界又被 trip:night 拦下,
      // 任务#7 三次空转,三分钟后她溺死在海里。
      if (movesTowardShelter(step, facts)) return false;
      if (skill === 'find' && typeof step.direction === 'string') {
        return typeof step.distance === 'number' && step.distance >= MARCH_LONE_BLOCKS;
      }
      const far = tripDistance(step, facts);
      return far !== null && far >= MARCH_LONE_BLOCKS;
    }
    case 'dig:down': {
      if (skill !== 'excavate' && skill !== 'tunnel') return false;
      const low = lowestY(step);
      return low !== null && low <= DESCENT_Y;
    }
    case 'fight:hostile': {
      if (skill !== 'attack') return false;
      const target = typeof step.target === 'string' ? step.target.toLowerCase() : '';
      return HOSTILE_MOBS.has(target);
    }
    case 'work:hard':
      return HARD_WORK.has(skill);
    case 'leave:shelter': {
      const home = homeOf(facts);
      if (!home) return false; // 既没重生点也没记过床,就没有"离开庇护点"这回事
      // 在原地动手(封闭、垫脚、就地挖)不是出门,哪怕脚下那一点已经在圈外 ——
      // 她此刻站在哪是既成事实,约束只能管"往哪去",不能管"能不能把自己围起来"。
      if (staysInPlace(step, facts)) return false;
      // 往家走永远放行:回家是夜里的解,不是违规
      if (movesTowardShelter(step, facts)) return false;
      for (const p of reachPoints(step)) {
        if (horizDist(p, home) >= SHELTER_RADIUS) return true;
      }
      // 不带坐标但明确要出门的:行军/找东西
      if (skill === 'find' && typeof step.direction === 'string') return true;
      return false;
    }
    case 'trip:night': {
      // 就地动手放行:封闭自己、垫方块、原地挖两格,这些正是夜里该干的事
      if (staysInPlace(step, facts)) return false;
      // 带方向的 find 一律算出行 —— 方向类目标跑多远由执行器决定,她拦不住
      if (skill === 'find' && typeof step.direction === 'string') return true;
      // 任何带绝对落点都按直线距离判(不只 goto:use/build 也得先走过去);
      // 相对锚点判不出,放行(约束不做第二故障源)
      // 往家走永远放行 —— 夜里回家睡觉是最优解,旧版把它和出门一起拦了
      if (movesTowardShelter(step, facts)) return false;
      const far = tripDistance(step, facts);
      return far !== null && far >= NIGHT_TRIP_BLOCKS;
    }
    case 'surface:open': {
      // 「上地表」= 从下往上跑到露天。人已经在露天上时这一条不成立 ——
      // 否则夜里她只要站在地面上,任何一步都算违规,又变成"禁止一切"。
      if (facts.pos !== null && facts.pos[1] >= SURFACE_Y) return false;
      for (const p of reachPoints(step)) if (p[1] >= SURFACE_Y) return true;
      return false;
    }
    case 'gather:raw': {
      // collect 只认木石类:打猎/钓鱼/摘浆果是找吃的,不在这里拦
      if (skill !== 'collect' && skill !== 'excavate') return false;
      const block = typeof step.block === 'string' ? step.block.toLowerCase() : '';
      if (skill === 'collect') return RAW_MATERIALS.some((n) => block.includes(n));
      // excavate 清方块的活:饥饿时也是纯消耗,一并算
      return true;
    }
    case 'enter:water': {
      // 已经在水里的不算"下水":这条拦的是"再往水里去",不是"现在怎么上来" ——
      // 人在水里时连 surface/goto 都要放行,否则她只能在原地淹死。
      if (facts.inWater) return false;
      // 打鱼是唯一被允许的下水理由的邻居:拦的是"跳进水里打水下生物"。
      // 站岸上打浅滩的鱼不算(inWater 为 false 时不判)。
      if (skill === 'attack') {
        const target = typeof step.target === 'string' ? step.target.toLowerCase() : '';
        // 水下生物:鱼、鱿鱼、海豚、守卫者、溺尸
        return /^(cod|salmon|tropical_fish|pufferfish|squid|glow_squid|dolphin|guardian|elder_guardian|drowned|turtle)$/.test(target);
      }
      // 往水里走:任何带落点的技能,落点比她脚下水面低 3 格以上
      //
      // 不认技能名,和 trip:* 同理:14:28 那单她是用 `use at=家` 走完 133 格的,
      // 只认 goto 的判定对她等于不存在。这里改成看落点高度。
      if (facts.pos) {
        let deep: number | null = null;
        for (const q of reachPoints(step)) {
          const drop = facts.pos[1] - q[1];
          deep = deep === null ? drop : Math.max(deep, drop);
        }
        // 只按高度判:低 3 格以上才可能是水下,别把"走到海边平地"也算下水
        if (deep !== null && deep >= 3) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/** 一条生效中的约束。derived 与 declared 走同一条判定路径,只有来源不同 */
export interface ActiveConstraint {
  /** 稳定标识:derived 用固定 id,declared 用 `goal#<slot>` */
  id: string;
  source: 'derived' | 'declared';
  /** 她的原话(derived 由系统给一句) */
  text: string;
  forbid: readonly ForbidCode[];
  /** 解除条件的人类可读描述 */
  releaseText: string;
  /** 解除条件此刻达没达到(只在回执里念) */
  releaseHint: string;
  /** 已经越权几次 */
  overrides: number;
}

export interface Violation {
  constraint: ActiveConstraint;
  stepIndex: number;
  code: ForbidCode;
}

/**
 * 求交集:哪些步违反了哪条约束。
 *
 * 返回的是**逐条逐步**的对账,不是"这单不行" —— 受理回执要靠它说清
 * "第 2 步是出门,第 1 步洞里挖铁没问题,可以拆成两单先做第 1 步"。
 */
export function findViolations(
  constraints: readonly ActiveConstraint[],
  steps: readonly unknown[],
  facts: ConstraintFacts,
): Violation[] {
  const out: Violation[] = [];
  for (const constraint of constraints) {
    if (constraint.forbid.length === 0) continue;
    for (let i = 0; i < steps.length; i++) {
      for (const code of constraint.forbid) {
        if (stepViolates(code, steps[i], facts)) {
          out.push({ constraint, stepIndex: i, code });
          break; // 同一步对同一条约束只记一次
        }
      }
    }
  }
  return out;
}

/**
 * 世界自己派生出来的约束:不依赖模型记得。
 *
 * 这是「目标丢失」的解药 —— 她忘了,系统没忘。派生约束不占目标表的格子
 * (五格是她的注意力清单,不能被系统自己的判断吃光),只在快照和受理刻出现。
 */
export function deriveConstraints(facts: ConstraintFacts): ActiveConstraint[] {
  const out: ActiveConstraint[] = [];

  // 夜里别出门。**不挂"没有重生点"这个前件** —— 首版挂了,后果是反的:
  // 她一旦睡过一次床,hasSpawn 变 true,这道闸就永久失效,而夜里乱走照样发生。
  // 实测 2026-11-08:17:23 设好床之后当天又死了 9 次(被箭射死×3、魔法×2、被打死×2、摔死×1)。
  // 床只把复活点搬近,挡不住骷髅的箭;夜里该不该出门与有没有床无关。
  //
  // 死亡计数的门槛也从「≥2」降到「≥1」:今天已经死了 28 次,还要"死够两次才拦",
  // 等于用第二条命去证明第一条命死得对。
  if (facts.night) {
    out.push({
      id: 'no-spawn-night',
      source: 'derived',
      text: facts.hasSpawn ? '天黑了,出门的活先别接' : '夜里没有重生点,出门的活先别接',
      // 只拦"出去"。**不拦 work:hard** —— 首版把 build/smelt 一起拦了,结果
      // 她在洞里放一块泥土垫脚都被拒,而那正是夜里该干的事。夜里要的是"别出门",
      // 不是"别动手":搭庇护所、烧炭、修工具、在洞里挖,全都得放行。
      //
      // 补上 leave:shelter 是因为实测漏得厉害:trip:far 只拦 ≥64 格,而她夜里的
      // 死亡点离床只有 20–56 格 —— 全在 64 格门槛内,一次都没拦。夜里在 30 格外
      // 挨一箭和被炸死,跟走 64 格没有区别。有庇护点时按 24 格算,没有时不判(见判定函数)。
      //
      // 再补 fight:hostile:夜里「主动去打一只怪」和「出门」是同一件事的两面 ——
      // 2026-11-08 的 34 次死亡里僵尸 9 次、骷髅 6 次,绝大多数发生在天黑之后。
      // 挨打自动还手是反射层的活(不在这条禁止集里,照样还手);这里拦的是
      // 「天黑了,我还想主动去打一只」这种开新单。
      //
      // 最后补 trip:night:leave:shelter 只在"有庇护点"时才算数,而 2026-11-08 22:44
      // 那次死亡记录里写的是「当前重生点 无」—— 没有庇护点时夜闸对出行完全不判,
      // 23:07 她就在夜里往东走了 33 格。夜里该不该出门,不该取决于有没有床。
      forbid: ['trip:far', 'trip:night', 'dig:down', 'surface:open', 'leave:shelter', 'fight:hostile'],
      // 解除条件只剩「天亮」这一个世界事实。床不再算解除 —— 它本来就不是夜里的危险源。
      releaseText: '天亮',
      releaseHint: facts.minutesToDawn === null
        ? '现在是夜里'
        : `离天亮约 ${Math.max(1, Math.round(facts.minutesToDawn))} 分钟`,
      overrides: 0,
    });
  }

  // 血见底:先保命。只拦"会让她更接近死"的三类,吃喝整理照常
  //
  // 触发线取 13 不是 8:8 点血只够挨两下僵尸,而撤退要跑满 16 格(约 4 秒,够再挨 2–3 下)。
  // 实测 2026-11-08 一天 19 次死亡里 15 次死于战斗,血线到 8 才拦等于拦在收尸之后。
  // 13 与 reflex.fleeHealth(14)同一根线:战斗层在 13 掉头,约束层在 13 不再许她主动开新战。
  if (facts.health <= 13) {
    out.push({
      id: 'low-health',
      source: 'derived',
      text: '血太少,先别去硬碰硬',
      // enter:water 并进这一档:血少时下水是最快的死法(没掩体、氧气见底、被水推)。
      // 2026-11-09 的五次溺死里有三次血线在 13 以上 —— 低血闸当时管不到水。
      forbid: ['fight:hostile', 'trip:far', 'dig:down', 'enter:water'],
      // 解除线比触发线高 3 点(13 触发 / 16 解除):贴着触发线解除会抖 —— 回一点血就放行、
      // 挨一下就再拦,快照里那条约束来回刷屏,她读到的全是噪声。3 点也正好是一整下僵尸。
      releaseText: '生命回到 16 以上',
      releaseHint: `现在 ${Math.ceil(facts.health)}/20,还差 ${Math.max(0, Math.ceil(16 - facts.health))} 点`,
      overrides: 0,
    });
  }

  // 见底的口粮配上见底的饥饿,是这台机器上最确定的一条死法:先去弄吃的,别的都不急
  //
  // 触发线从 6 提到 10:2026-11-08 的日志里她在"饥饿 1–12、生命 5/20、包里零食物"
  // 这个状态下连续作业了几个小时,当天 16 次被僵尸打死 —— 每一次都发生在"没口粮还在接活"
  // 的窗口里。饥饿 6 才拦已经太晚:那时连疾跑都关了(6 以下不许跑),遇到僵尸跑都跑不掉。
  // 10 是一条"还有救"的线:这个点数吃一口还能回到能回血的区间。
  if (facts.food <= 10 && !facts.hasMeal) {
    out.push({
      id: 'starving',
      source: 'derived',
      text: '没吃的了,先弄吃的',
      // 不打、不下潜、不出远门:这三类都是"要花时间、还可能受伤"的活,
      // 而在没口粮的状态下受伤就回不来(没有回血通道)。
      //
      // 补 gather:raw:2026-11-09 11:44–13:11 她饥饿 0/20 连续砍了一个半小时木头
      // (任务#72 等),中途摔死一次。饥饿 0 时砍树既换不来这一顿、又在露天耗体力,
      // 属于"看起来在干活、实际在等死"。打猎钓鱼摘果子不在这一格里。
      forbid: ['work:hard', 'fight:hostile', 'dig:down', 'trip:far', 'gather:raw', 'enter:water'],
      releaseText: '弄到吃的(包里有一份不毒的food)或饱食度回到 12 以上',
      releaseHint: `现在 ${Math.round(facts.food)}/20,包里一口吃的都没有`,
      overrides: 0,
    });
  }

  // 没有重生点还走 96 格:死了不但丢东西,还要从世界出生点跑回来
  //
  // 这条约束保留(没重生点确实是风险状态),但「回家把重生点绑回来」必须放行 ——
  // 例外做在 stepViolates 的 trip:lone 里(movesTowardShelter),不在这里删约束。
  // 2026-11-09 14:21-14:28 她三次想 goto 回 120 格外的家全被拒,最后死在海里。
  if (!facts.hasSpawn) {
    out.push({
      id: 'no-spawn-far',
      source: 'derived',
      text: '没有重生点,别走太远',
      // 只拦 ≥96 格。64 格那一档留给 trip:far(夜里/低血),因为剪羊毛做床
      // 往往是 60 格上下的一趟 —— 拦掉它等于把解除条件本身堵死。
      forbid: ['trip:lone'],
      releaseText: '弄到一张床(3 块羊毛 + 3 块木板)把重生点定下来',
      releaseHint: '现在死了回世界出生点,攒的东西全留在原地',
      overrides: 0,
    });
  }

  return out;
}

/**
 * 允许集:拒绝一个人之后必须立刻给出"那你现在能干什么"。
 *
 * 旧闸的劝告是三句正确但不可执行的模板句("先把血吃回来、躲开威胁,或者等天亮再来")。
 * 这里按"当前世界里立刻能做"生成,顺序就是该动手的顺序:先补状态,再干活,最后才是出门。
 */
export function allowedHints(
  constraints: readonly ActiveConstraint[],
  facts: ConstraintFacts,
): string[] {
  const blocked = new Set<ForbidCode>();
  for (const c of constraints) for (const code of c.forbid) blocked.add(code);
  if (blocked.size === 0) return [];

  const hints: string[] = [];
  const home = homeOf(facts);
  // ① 解除条件本身这件事最该先说:做床、吃饭、回血
  if (!facts.hasSpawn) {
    // 家里已经有床的时候,"回家"比"再凑一张"便宜得多 —— 这一句必须压在前面,
    // 否则她会在离家 120 格的地方重新找羊(2026-11-09 13:43-13:45 的实况)。
    hints.push(home === null
      ? '凑床:3 块羊毛 + 3 块木板。羊毛要出门找 —— 出门正是被拦的那类,所以这一步留给天亮'
      : `回家把重生点绑回来:床在 (${Math.round(home[0])},${Math.round(home[1])},${Math.round(home[2])}),`
        + '往家走的 goto 全天放行(夜里也算),走到床边 3 格内系统会自己躺下;别在野外重新找羊');
  }
  if (facts.food < 16) {
    hints.push(facts.hasMeal
      ? '先吃一口把饱食度顶上去(18 以上才开始回血)'
      : '先弄到吃的:近处的鱼群/畜群/庄稼,24 格以内不算走远');
  }
  // ② 夜里出不去:能立刻做的只有"回家"或"就地封闭",这一句要顶在最前面
  if (blocked.has('trip:night')) {
    // 家比脚下近就让她回去睡 —— 这是最省事的一档,比封闭强
    const homeHint = home !== null && facts.pos !== null
      ? `回家睡:床在 (${Math.round(home[0])},${Math.round(home[1])},${Math.round(home[2])}),`
        + `比你现在近 —— 往家走的 goto 夜里放行,站到床边 3 格内系统会自己躺下`
      : '';
    if (homeHint !== '') hints.push(homeHint);
    hints.push('就地封闭过夜:背靠墙或土坡用 tunnel 往里挖两格站进去(或 build 拿泥土把自己围成 1×2×1、顶上封住),脚边插一根火把,天亮再出门 —— 6 格以内的动手不算出门,不会被拦');
  }
  // ③ 洞里的活:这几类不受任何约束限制
  if (blocked.has('work:hard') || blocked.has('trip:far') || blocked.has('dig:down')) {
    // 被水闸拦下时,唯一正确的替代动作是"站岸上想办法" —— 必须明说,
    // 否则她会换个坐标继续下水(提示词写了 41 行「不在水里追鱼」,实测追了 100 次)。
    if (blocked.has('enter:water')) {
      hints.push('要鱼就站岸上:拿钓鱼竿钓(需要 3 木棍 + 2 线),或在浅滩上手打露出水面的鱼 —— 不下水也能吃到鱼;附近没有岸就先回陆地');
    }    hints.push('合成、烧炼、整理背包、修工具 —— 这几样不吃位置也不吃血');
    if (blocked.has('surface:open')) {
      hints.push('搭庇护所、垫方块、堵门洞都在洞里做,不算出门');
    }
    if (blocked.has('dig:down')) {
      const y = facts.pos === null ? '?' : Math.round(facts.pos[1]);
      hints.push(`就地挖矿照样行:dig:down 只拦 y≤${DESCENT_Y},你现在 y=${y}`);
    } else if (!blocked.has('work:hard')) {
      hints.push('就近挖矿(不离开庇护点 24 格)不算出门');
    }
  }
  return hints.slice(0, 4);
}

/** 快照/回执里念一条约束 */
export function constraintLine(c: ActiveConstraint): string {
  const forbid = c.forbid.length === 0
    ? '不拦任何动作(只表态)'
    : `禁止:${c.forbid.map((code) => FORBID_VOCAB[code]?.zh ?? code).join('/')}`;
  const over = c.overrides > 0 ? `;已越权 ${c.overrides} 次` : '';
  const src = c.source === 'derived' ? '系统约束:' : '约束:';
  return `${src}${c.text}(${forbid};解除:${c.releaseText},${c.releaseHint})${over}`;
}

/** 快照里那一整段。没有约束时返回空串,由调用方决定要不要占一行 */
export function constraintSnapshotLine(list: readonly ActiveConstraint[]): string {
  if (list.length === 0) return '';
  return list.map((c) => constraintLine(c)).join(' · ');
}
