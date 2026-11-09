# T14：live gate 直播模式闸

> 波次 4 / 链 2。依赖：**T13 已合并**。分支 `mc/T14-livegate`，worktree `D:/code/wt-mc-T14`。

## 公共背景（必读）

- 你在 worktree 里工作（**基线含 T13 产物**）：
  ```bash
  cd D:/code/live_by_ai/external/cortico-world-minecraft
  git worktree add D:/code/wt-mc-T14 -b mc/T14-livegate
  cd D:/code/wt-mc-T14
  ```
- 测试命令：`node --experimental-strip-types --test tests/*.test.ts`（基线全绿，完成时必须全绿）。
- 零新增 npm 依赖；单测禁止真实连接。
- 参考实现（**只读**）：`D:/code/live_by_ai/external/Amaidesu/src/agents/minecraft/agent.py:257-289`——`_live_active` 由 live.started/ended 事件驱动；**收工即丢队列**（直播结束不残留弹幕驱动的任务）；参考测试 `tests/agents/test_minecraft_live_gate.py`（构造器注入 AsyncMock 直测）。

## 问题

cortico 的弹幕注入（collectors/danmaku-collector，T10 产物）在直播中会触发行为，但"直播中/非直播"没有一等公民的状态：直播结束后弹幕驱动的队列意图还在，非直播时段的行为模式与直播中无差异（ENV_PROMPT 里只有文字性约定"观众不是玩家"）。

## 你的任务

1. **新建 `src/live-gate.ts`**：`LiveGate` 类——
   - 状态源：danmaku-collector 的运行态（T10 产物暴露 `isRunning()` 或等价接口；若无则经注入回调订阅）+ 可选手动开关；
   - 语义：`isLive()` / 事件 `live-started` / `live-ended`；
   - **live-ended 时清空弹幕驱动的队列意图**（Amaidesu"收工即丢队列"）：暴露 `onLiveEnd(cb)` 钩子，由 executor/GoalService 侧注册清理——本卡只做闸与钩子分发，**不直接改 executor 内部**（改在 world.ts 接线层）。
2. **接入**：world.ts 接线 live-gate；ENV_PROMPT.md 加一节"直播模式"说明（数字引用 policy.ts 常量，遵守 T2 的一致性测试——**该测试必须仍然全绿**）。
3. **新建 `tests/live-gate.test.ts`**：构造器注入 fake collector 状态，验证状态翻转、事件分发、ended 后队列清理钩子被调用、手动开关覆盖。≥ 10 用例。

## 禁区

- `src/executor.ts` 深层内部（只经 world.ts 接线层挂钩子；executor 本体改动 ≤ 30 行）。
- Wave 3 产物（combat-coordinator/goal-service/server-lifecycle/collectors/base）只读。
- `src/context-layers.ts`（T13 产物，只读）。

## 验收

1. 测试全绿（含 T2 的一致性测试）。
2. `git diff main --stat -- src/collectors/base.ts src/context-layers.ts` 为空。
3. 报告含"直播开始/结束"两场景的行为时序图（文字版即可）。

## 交付

提交到分支，报告：闸的设计、清理钩子注册点、测试数。**不要合并到 main**。完成后提示「T12 可开工（最后一卡）」。
