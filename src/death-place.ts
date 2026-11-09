/**
 * 「这两次死在不在同一片地方」—— 纯函数,不 import 世界包,好测。
 *
 * 单独成文件不是为了分层,是因为 `deaths.ts` 依赖宿主包 `cortico/core/util.ts`,
 * 在 fork 目录里跑不起单测;把判定摘出来才验得动。
 */

/**
 * 「死在同一片地方」的水平半径(格)。
 *
 * 原来按 cell 字符串全等判,实测太严:2026-11-08 她在 (21,48,-373) 与 (16,44,-373)
 * 各死两次、(-5,63,-373) 与 (8,63,-377) 各死一次 —— 五条命铺在同一片 30 格见方的
 * 地方,而全等判定一次都没点出来。摔死尤其如此:每次落点差一两格,永远凑不成"第 2 次"。
 *
 * 取 16:与 ENV_PROMPT.md「16 格以内死第二次,今天不往那个方向去」同一口径。
 * 提示词许诺的判据与代码实现必须是同一个数,否则那条话永远不兑现。
 */
export const SAME_PLACE_RADIUS = 16;

function parseCell(cell: string): { dim: string; x: number; z: number } | null {
  // `维度:x,y,z`:维度本身可能带冒号(minecraft:overworld),所以从最后一个冒号切
  const cut = cell.lastIndexOf(':');
  if (cut < 0) return null;
  const dim = cell.slice(0, cut);
  const nums = cell.slice(cut + 1).split(',');
  if (nums.length !== 3) return null;
  const x = Number(nums[0]);
  const z = Number(nums[2]);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { dim, x, z };
}

/**
 * 两个 `维度:x,y,z` 是不是同一片地方(水平距离 ≤ SAME_PLACE_RADIUS,维度必须相同)。
 *
 * 解析不出来就退回字符串全等 —— 判不出来的时候宁可少算一次,也不要凭空把两处
 * 不相干的地方并成一格。
 */
export function samePlace(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  if (a === b) return true;
  const pa = parseCell(a);
  const pb = parseCell(b);
  if (pa === null || pb === null) return false;
  if (pa.dim !== pb.dim) return false;
  return Math.hypot(pa.x - pb.x, pa.z - pb.z) <= SAME_PLACE_RADIUS;
}
