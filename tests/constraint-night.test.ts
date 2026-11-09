import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveConstraints, stepViolates, allowedHints, type ConstraintFacts } from '../src/constraint.ts';

/** 白天、满血、吃饱、没床 —— 什么约束都不该有 */
const day: ConstraintFacts = {
  night: false,
  hasSpawn: false,
  health: 20,
  food: 20,
  hasMeal: true,
  todayDeaths: 0,
  pos: [0, 64, 0],
  shelter: null,
  bedPos: null,
  minutesToDawn: null,
};

const ids = (f: ConstraintFacts): string[] => deriveConstraints(f).map((c) => c.id);

test('白天满状态:没床只挂"别走太远",不挂别的', () => {
  // 没重生点就别走 96 格是常驻约束(与昼夜无关),所以这里只该有它
  assert.deepEqual(ids(day), ['no-spawn-far']);
  // 有床之后白天一条都不该有
  assert.deepEqual(ids({ ...day, hasSpawn: true, shelter: [0, 64, 0] }), []);
});

test('有床也照样拦夜 —— 这是本轮修的核心', () => {
  // 旧逻辑要求 !hasSpawn,于是她 17:23 睡过床之后这道闸永久失效,
  // 当晚又死了 9 次。床只把复活点搬近,挡不住骷髅的箭。
  const withBed = ids({ ...day, night: true, hasSpawn: true, shelter: [0, 64, 0] });
  assert.ok(withBed.includes('no-spawn-night'), '有床也必须挂夜间约束');
});

test('没床更该拦夜', () => {
  assert.ok(ids({ ...day, night: true, hasSpawn: false }).includes('no-spawn-night'));
});

test('夜间约束包含 leave:shelter,不只是 trip:far', () => {
  // 旧禁止集只有 trip:far(≥64 格),而她夜里的死亡点离床 20–56 格,一次都没拦住
  const c = deriveConstraints({ ...day, night: true, hasSpawn: true, shelter: [0, 64, 0] })
    .find((x) => x.id === 'no-spawn-night');
  assert.ok(c);
  assert.ok(c.forbid.includes('leave:shelter'));
});

test('夜间约束的解除条件只剩天亮(床不再算解除)', () => {
  const c = deriveConstraints({ ...day, night: true, hasSpawn: true, shelter: [0, 64, 0] })
    .find((x) => x.id === 'no-spawn-night');
  assert.equal(c?.releaseText, '天亮');
});

test('夜里不拦动手(挖矿/合成/烧炼),只拦出门', () => {
  const c = deriveConstraints({ ...day, night: true, hasSpawn: true, shelter: [0, 64, 0] })
    .find((x) => x.id === 'no-spawn-night');
  assert.ok(!c!.forbid.includes('work:hard'), '夜里在洞里搭墙、烧炭必须放行');
});

test('血 ≤13 触发,16 才解除', () => {
  assert.ok(ids({ ...day, health: 13 }).includes('low-health'));
  assert.ok(!ids({ ...day, health: 14 }).includes('low-health'));
});

test('饿到 10 且没口粮就拦:没回血通道时还在接活是死因', () => {
  assert.ok(ids({ ...day, food: 6, hasMeal: false }).includes('starving'));
  assert.ok(ids({ ...day, food: 10, hasMeal: false }).includes('starving'), '饥饿 10 已无回血余量');
  assert.ok(!ids({ ...day, food: 6, hasMeal: true }).includes('starving'));
  assert.ok(!ids({ ...day, food: 11, hasMeal: false }).includes('starving'));
});

test('夜里没床也拦出行 —— 22:44 那次死亡时 shelter 是 null', () => {
  // leave:shelter 要有庇护点才算数,没有重生点时夜闸对出行完全不判:
  // 23:07 她就在夜里往东走了 33 格。trip:night 不依赖 shelter。
  const c = deriveConstraints({ ...day, night: true, hasSpawn: false }).find((x) => x.id === 'no-spawn-night');
  assert.ok(c);
  assert.ok(c.forbid.includes('trip:night'));
  const facts: ConstraintFacts = { ...day, night: true, hasSpawn: false };
  assert.equal(stepViolates('trip:night', { skill: 'find', direction: 'east', distance: 40 }, facts), true);
  assert.equal(stepViolates('trip:night', { skill: 'goto', at: [0, 64, 30] }, facts), true, '30 格也是出行');
  assert.equal(stepViolates('trip:night', { skill: 'goto', at: [0, 64, 8] }, facts), false, '洞里横着走两步不该拦');
  assert.equal(stepViolates('trip:night', { skill: 'tunnel', at: [0, 63, 2] }, facts), false, '就地封闭要放行');
});


// ── 2026-11-09 12:34 实测:夜闸把"就地封闭"和"回家"一起拦了 ─────────────
// 她离家 30 格、天黑了,想背靠土坡挖两格把自己封起来,leave:shelter 判"目标离床 ≥24 格"
// 于是 6 次拒单(12:34:20/29/37/42/52/58)。约束把解除自己的路堵死,这是第二次。

/** 离家 30 格、天黑了、有床有口粮 */
const farAtNight: ConstraintFacts = {
  ...day, night: true, hasSpawn: true, shelter: [0, 64, 0], pos: [30, 64, 0],
};

// ── 2026-11-09 14:21 实测:重生点丢了之后"回家"被两道闸夹死 ─────────────
// 重生点是内存态,每次重连被清空(`setPersonalSpawn(null,'重连,基线作废')`),
// 而 external 模式下 hydrate 直接 return —— shelter 恒为 null。
// 于是 movesTowardShelter 恒 false,trip:night 拦 ≥24 格、trip:lone 拦 ≥96 格,
// 她离家 120 格想 goto 回床:越权放行 no-spawn-far 之后,到步边界又被 trip:night 拦掉,
// 任务#7 原地空转三分钟,最后溺死。路标表里那张床一直在。

test('重生点丢了但路标表有床:回家必须放行(两个闸都要)', () => {
  const lost: ConstraintFacts = {
    ...day, night: true, hasSpawn: false, shelter: null, bedPos: [0, 64, 0], pos: [120, 64, 0],
  };
  assert.equal(stepViolates('trip:night', { skill: 'goto', at: [0, 64, 0] }, lost), false, '夜里回家放行');
  assert.equal(stepViolates('trip:lone', { skill: 'goto', at: [0, 64, 0] }, lost), false, '没重生点也放行回家');
  assert.equal(stepViolates('leave:shelter', { skill: 'goto', at: [0, 64, 0] }, lost), false);
  // 离家更远还是照拦
  assert.equal(stepViolates('trip:lone', { skill: 'goto', at: [240, 64, 0] }, lost), true);
});

test('床只在路标表里时,night 约束照样拦出行(不是有床就放羊)', () => {
  const lost: ConstraintFacts = {
    ...day, night: true, hasSpawn: false, shelter: null, bedPos: [0, 64, 0], pos: [0, 64, 40],
  };
  assert.equal(stepViolates('trip:night', { skill: 'find', direction: 'east', distance: 32 }, lost), true);
  assert.equal(stepViolates('trip:night', { skill: 'goto', at: [0, 64, 80] }, lost), true, '往远走不是回家');
});

test('被拒回执要先说"回家绑重生点",不是让她野外重新找羊', () => {
  const lost: ConstraintFacts = {
    ...day, night: true, hasSpawn: false, shelter: null, bedPos: [0, 64, 0], pos: [120, 64, 0],
  };
  const hints = allowedHints(deriveConstraints(lost), lost);
  assert.ok(hints.some((h) => h.includes('回家把重生点绑回来')), `实际:${hints.join(' | ')}`);
  assert.ok(!hints.some((h) => h.startsWith('凑床')), '有床就别让她再凑一张');
});

test('就地封闭不被夜闸拦 —— 脚下已在圈外也要放行', () => {
  // 12:34 那次:人在 30 格外,build 落在自己脚边
  assert.equal(stepViolates('leave:shelter', { skill: 'build', at: [30, 64, 0] }, farAtNight), false);
  assert.equal(stepViolates('trip:night', { skill: 'build', at: [30, 64, 0] }, farAtNight), false);
  // tunnel 往里挖两格(同一点)
  assert.equal(stepViolates('leave:shelter', { skill: 'tunnel', at: [30, 64, 0] }, farAtNight), false);
});

test('往家走永远放行 —— 回家睡觉是夜里的解', () => {
  const facts: ConstraintFacts = { ...farAtNight, pos: [80, 64, 0] };
  // goto 到床:80 → 0,更近了
  assert.equal(stepViolates('trip:night', { skill: 'goto', at: [0, 64, 0] }, facts), false);
  assert.equal(stepViolates('leave:shelter', { skill: 'goto', at: [0, 64, 0] }, facts), false);
  // 但离家更远还是拦
  assert.equal(stepViolates('trip:night', { skill: 'goto', at: [120, 64, 0] }, facts), true);
});

test('原地封闭的判定半径是 6 格,超出就算出门', () => {
  assert.equal(stepViolates('leave:shelter', { skill: 'build', at: [34, 64, 0] }, farAtNight), false, '4 格内算原地');
  assert.equal(stepViolates('leave:shelter', { skill: 'build', at: [40, 64, 0] }, farAtNight), true, '10 格外算出门');
});

// ── 饥饿时砍树 = 看起来在干活、实际在等死 ───────────────────────────────
// 11:44–13:11 她饥饿 0/20 连砍一个半小时木头,中途摔死一次。

test('饥饿且没口粮时拦砍树,不拦打猎钓鱼', () => {
  const hungry: ConstraintFacts = { ...day, food: 0, hasMeal: false };
  const c = deriveConstraints(hungry).find((x) => x.id === 'starving');
  assert.ok(c);
  assert.ok(c.forbid.includes('gather:raw'), '饥饿 0 砍树要拦');
  // 木石类拦
  assert.equal(stepViolates('gather:raw', { skill: 'collect', block: 'oak_log' }, hungry), true);
  assert.equal(stepViolates('gather:raw', { skill: 'collect', block: 'spruce_log' }, hungry), true);
  assert.equal(stepViolates('gather:raw', { skill: 'collect', block: 'cobblestone' }, hungry), true);
  // 找吃的放行
  assert.equal(stepViolates('gather:raw', { skill: 'collect', block: 'sweet_berry_bush' }, hungry), false);
  assert.equal(stepViolates('gather:raw', { skill: 'fish' }, hungry), false);
  assert.equal(stepViolates('gather:raw', { skill: 'attack', target: 'cow' }, hungry), false);
});

// ── 距离只管 goto 等于不管她怎么走 ──────────────────────────────────────
// 14:28:09 任务#4:第 1 步 goto 家被 trip:lone 拦下,执行器把第 2 步
// `use at=同一个家` 念成「不违规,可以拆出来先做」。她朝 133 格外的家走,
// 一路垫橡木木板把自己闷进方块、脚下又是水,39 秒后窒息+溺水死在 (-57,61,19)。
// 约束只禁止违反它的动作,不等于只禁止"说得出口的那一个技能名"。

test('不带 goto 名字也要按距离判 —— use/build 同样得走过去', () => {
  const lone: ConstraintFacts = { ...day, hasSpawn: false, pos: [0, 64, 0] };
  // 同一个家的坐标,换技能名不该换结论
  assert.equal(stepViolates('trip:lone', { skill: 'goto', at: [133, 64, 0] }, lone), true, 'goto 拦');
  assert.equal(stepViolates('trip:lone', { skill: 'use', at: [133, 64, 0] }, lone), true, 'use 也得拦');
  assert.equal(stepViolates('trip:lone', { skill: 'build', at: [133, 64, 0] }, lone), true, 'build 也得拦');
  assert.equal(stepViolates('trip:far', { skill: 'use', at: [80, 64, 0] }, day), true, 'trip:far 同理');
  // 近处照常放行
  assert.equal(stepViolates('trip:lone', { skill: 'use', at: [6, 64, 0] }, lone), false);
});

test('回家那一步换成 use 也放行 —— 床是要右键的', () => {
  const facts: ConstraintFacts = { ...day, hasSpawn: false, shelter: [0, 64, 0], pos: [120, 64, 0] };
  assert.equal(stepViolates('trip:lone', { skill: 'use', at: [0, 64, 0] }, facts), false);
  assert.equal(stepViolates('leave:shelter', { skill: 'use', at: [0, 64, 0] }, facts), false);
  // 但一块跑偏的蓝图不算回家:落点里有更远的就要拦
  assert.equal(
    stepViolates('trip:lone', { skill: 'build', at: [0, 64, 0], anchors: [[200, 64, 0]] }, facts),
    true,
  );
});

test('build 的贴面形态也要按距离判 —— 落点在 on[] 里,顶层没有 at', () => {
  // 14:28 那单是 use;同一条路上她也在"边走边放置",贴面形态同样得管
  const facts: ConstraintFacts = { ...day, health: 8, pos: [0, 40, 0] };
  const near = { skill: 'build', on: [{ at: [3, 40, 3], face: 'up' }], material: 'dirt' };
  const far = { skill: 'build', on: [{ at: [200, 40, 200], face: 'up' }], material: 'dirt' };
  assert.equal(stepViolates('trip:far', near, facts), false, '近处贴面放行');
  assert.equal(stepViolates('trip:far', far, facts), true, '200 格外贴面要拦');
});

test('enter:water 也不认技能名 —— 落点在水面下就算', () => {
  // 5 次淹死全在 y=61(海平面)。她用 use/build 走到低处一样会泡在水里
  const facts: ConstraintFacts = { ...day, health: 8, pos: [0, 64, 0] };
  assert.equal(stepViolates('enter:water', { skill: 'goto', at: [5, 55, 5] }, facts), true, 'goto 下水拦');
  assert.equal(stepViolates('enter:water', { skill: 'use', at: [5, 55, 5] }, facts), true, 'use 下水也拦');
  assert.equal(stepViolates('enter:water', { skill: 'fish', at: [5, 55, 5] }, facts), true, 'fish 下水也拦');
  // 走到平地上不算下水
  assert.equal(stepViolates('enter:water', { skill: 'goto', at: [5, 63, 5] }, facts), false);
  // 已经在水里:任何动作都放行,否则她只能在原地淹死
  assert.equal(stepViolates('enter:water', { skill: 'goto', at: [5, 55, 5] }, { ...facts, inWater: true }), false);
});
