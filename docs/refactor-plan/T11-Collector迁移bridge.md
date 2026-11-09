# T11：bridge 事件流迁移到 Collector

> 波次 3 / 轨道 B（并发组 B2）。依赖：**T10 已合并到 main**（要用 collectors 框架）。分支 `mc/T11-bridge-collector`，worktree `D:/code/wt-mc-T11`。
> 与轨道 A（T9 拆 world.ts）并行，纪律同 T10：不碰 world.ts。

## 公共背景（必读）

- 你在 worktree 里工作（**基线含 T10 的 `src/collectors/base.ts`**）：
  ```bash
  cd D:/code/live_by_ai/external/cortico-world-minecraft
  git worktree add D:/code/wt-mc-T11 -b mc/T11-bridge-collector
  cd D:/code/wt-mc-T11
  ```
- 测试命令：`node --experimental-strip-types --test tests/*.test.ts`（基线全绿，完成时必须全绿）。
- 零新增 npm 依赖；单测禁止真实连接（bridge collector 测试用 fake bot 事件源，参考 `tests/collectors/danmaku.test.ts`（T10 产物）的做法）。
- 参考（**只读**）：`D:/code/live_by_ai/external/Amaidesu/src/agents/minecraft/events_collector.py`（带退避的事件长轮询采集器）与 `chat_collector.py`。

## 问题

`src/bridge.ts`（814 行）管 mineflayer 连接/重连/viewer，bot 实例重连会替换、经 `bridge.bot` 现取。事件订阅散在 bridge/世界两侧，重连后订阅恢复逻辑分散，生命周期语义与弹幕流（T10 已迁）不统一。

## 你的任务

1. **新建 `src/collectors/bridge-events-collector.ts`**：基于 `collectors/base.ts` 框架，把 bridge 的事件订阅（chat、玩家进出、死亡、伤害等 world 关心的事件——grep `bot.on(` 盘点）收敛为 collector。**重连恢复**（bot 实例替换后自动重挂订阅）是本卡的核心价值：collector 的 collect() 循环监听 bridge 的 bot 替换事件，替换后重挂订阅——这就是 Amaidesu ADR-038"流的生命周期独立于实例"的意义。
2. **bridge.ts 改造**：连接/重连本体保留（含 Wave 1 的 backoff），新增"bot 替换"通知（订阅回调注入），事件转发交给 collector。**对 world.ts 的现有事件入口保持签名不变**（world 侧一行不改，collector 直接调 world 上已注册的 handler——经注入回调，无 world import）。
3. **新建 `tests/collectors/bridge-events.test.ts`**：fake bot（手写 EventEmitter 鸭子类型）验证：订阅挂载、事件→emit 转发、bot 替换后重挂（用两次 fake bot 实例模拟重连）、断流时 collector 进 errored 不炸。≥ 10 用例。

## 禁区

- `src/world.ts`（轨道 A 并行中，一行不碰）。
- `src/collectors/base.ts`（T10 产物，只读；若框架缺能力，报告里提需求，不擅改——万不得已小改时 diff ≤ 20 行并在报告显著标注）。
- `tests/fakes/`（T15 的）。

## 验收

1. 测试全绿。
2. `git diff main --stat -- src/world.ts src/collectors/base.ts` 为空（base.ts 如有 ≤20 行改动须在报告中说明并经集成者确认）。
3. `grep -c "bot.on(" src/bridge.ts` 显著下降（订阅转移到 collector）。
4. 重连重挂有测试用例证明。

## 交付

提交到分支，报告：迁移了哪些事件、重连重挂的实现方式、测试数。**不要合并到 main**。
