# T6：executor 去转口

> 波次 2 / 并发组 C。依赖：V1（Wave 1 已合并）。分支 `mc/T6-deexport`，worktree `D:/code/wt-mc-T6`。
> 小而关键：消除"调用方分不清依赖来源"的扇出点。

## 公共背景（必读）

- 你在 worktree 里工作：
  ```bash
  cd D:/code/live_by_ai/external/cortico-world-minecraft
  git worktree add D:/code/wt-mc-T6 -b mc/T6-deexport
  cd D:/code/wt-mc-T6
  ```
- 测试命令：`node --experimental-strip-types --test tests/*.test.ts`（基线 53 全绿，完成时必须全绿）。
- 零新增 npm 依赖；本卡是纯 import 重定向 + 删除，不碰任何逻辑。

## 问题

`src/executor.ts`（5225 行任务执行器）开头（49-62 行附近）有六组 re-export 转口，把别的模块的导出二次转卖：
`export { HOSTILE, bestWeapon, meleeCooldownMs } from './melee.ts'`、`export { dropOwnedGoal, ... } from './travel.ts'`、`export { ... } from './skill-context.ts'`、`export { describeSkill, zhErrorText } from './receipt.ts'` 等。

消费方（grep 已确认，共 6 处）从 `./executor.ts` import 这些名字：
- `src/readouts.ts`（**归 T5，不许碰**——T5 自己解）
- `src/world.ts`、`src/bridge.ts`、`src/combat.ts`、`src/mineflayer-fixes.ts`、可能还有 `src/skills-*.ts`

结果：调用方分不清 HOSTILE 来自 melee 还是 executor，依赖图失真，后续拆 executor 无从下手。

## 你的任务

1. **逐条列出 executor.ts 里所有 `export ... from './xxx.ts'` 转口**（`grep -n "^export {" src/executor.ts` + 后续行），每条找到真实源模块。
2. **删除全部转口**（executor.ts 只导出它自己的东西：QueueStatus/BlockedRecord/执行器类等本体）。
3. **消费方直连**：把上述消费方的 import 从 `./executor.ts` 改为真实源模块。注意合并 import（某文件可能既从 executor import 本体又 import 转口名——拆成两条 import 语句）。
4. **自检依赖方向**：改完后 `grep -rn "from './executor.ts'" src/` 逐条确认剩余 import 全部是 executor 本体（队列状态/执行器接口），没有一个转口名。把结果写进报告。
5. **跑全量测试**。本卡不改逻辑，测试必须原样全绿；如红，说明你改错了 import（查循环依赖：直连后若出现模块环，报告环路径，不要用转口糊回去，改为在报告里给出最小 type-only import 建议）。

## 禁区（其他 AI 并行在改）

- `src/readouts.ts`、`src/notice-router.ts`（T5 的）。
- 5 个账本文件 + `src/world.ts`（T4 的——**world.ts 里 executor 相关 import 你也直连**，但 diff 必须只出现在文件头 import 区，grep 检查 `git diff main -- src/world.ts` 无业务行改动。若与 T4 的接线改动撞行，集成者合并时解决，你照改不误）。
- `src/ENV_PROMPT.md`、`src/config.ts`、`src/constraint.ts`（Wave 1 已合）。

## 验收

1. `grep -c "^export.*from '\./" src/executor.ts` 输出 0（转口清零）。
2. 测试 53 全绿。
3. `git diff --name-only main` 只含：`src/executor.ts`、`src/world.ts`（仅 import 区）、`src/bridge.ts`、`src/combat.ts`、`src/mineflayer-fixes.ts`、`src/skills-*.ts`。
4. 报告里附"剩余 executor import 清单"（应全为本体导出）。

## 交付

提交到分支，报告：删了几组转口、改了几个消费文件、发现的任何循环依赖。**不要合并到 main**。
