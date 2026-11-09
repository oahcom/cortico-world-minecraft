# T8：拆 world.ts 第二刀——GoalService

> 波次 3 / 轨道 A（串行链 2/3）。依赖：**T7 已合并到 main**。分支 `mc/T8-goals`，worktree `D:/code/wt-mc-T8`。
> ⚠️ 必须等 T7 合并后开工（同动 world.ts）。

## 公共背景（必读）

- 你在 worktree 里工作（**注意 T7 已合并，你的基线含 T7 产物**）：
  ```bash
  cd D:/code/live_by_ai/external/cortico-world-minecraft
  git worktree add D:/code/wt-mc-T8 -b mc/T8-goals
  cd D:/code/wt-mc-T8
  ```
- 测试命令：`node --experimental-strip-types --test tests/*.test.ts`（基线=T7 合并后全绿，完成时必须全绿）。
- 零新增 npm 依赖；单测禁止真实连接。
- 参考实现（**只读**）：`D:/code/live_by_ai/external/Amaidesu/src/agents/minecraft/goals.py`（GoalWatch 后台目标长轮询：事件流→游标→回调）与 `goal_ledger.py`（三簿：此刻样子/暂停中/最近结束）。参考测试：`tests/agents/test_minecraft_goals.py`、`test_minecraft_goal_ledger.py`。

## 你的任务

1. **盘点目标域成员**：world.ts 里 goals 相关的字段/方法（目标表、owned-goal 记账——与 `travel.ts` 的 `setOwnedGoal/dropOwnedGoal`、executor 的队列目标语义交互的部分）。
2. **新建 `src/goal-service.ts`**：
   - `GoalService` 类：目标登记/查询/释放/三簿视图。 Amaidesu 的三簿语义值得抄——"此刻在跑/暂停中/最近结束"分离，查询天然纯函数化。
   - 与账本（Wave 2 已纯函数化的 deaths/works 等）的联动走接口注入。
   - **禁止 import world.ts**（单向依赖，同 T7 纪律）。
3. **world.ts 委托**：同 T7 手法。goal-plan.ts / travel.ts 若从 world 拿目标状态，改为从注入的 GoalService 拿（小接线）。
4. **新建 `tests/goal-service.test.ts`**：三簿状态转换（登记→运行→暂停→结束→最近结束窗口）、重复登记、释放语义。≥ 12 用例。

## 禁区

- `src/combat-coordinator.ts`（T7 产物，只读不改）。
- `src/danmaku-inject.ts`、`src/bridge.ts`、`src/collectors/`、`tests/fakes/`（轨道 B 并行中）。
- `src/ENV_PROMPT.md`、`src/policy.ts`、`src/notice-router.ts`（已合并产物，只读）。

## 验收

1. 测试全绿。
2. `wc -l src/world.ts` ≤ 4700；`goal-service.ts` > 800。
3. `git diff main --stat -- src/combat-coordinator.ts` 为空。
4. goal-service 无 world.ts import（单向依赖）。

## 交付

提交到分支，报告：三簿设计落地情况、world.ts 前后行数、测试数。**不要合并到 main**。
