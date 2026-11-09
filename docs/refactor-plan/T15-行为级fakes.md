# T15：行为级 fakes + executor 队列测试

> 波次 3 / 轨道 B（并发组 B3）。依赖：V2（Wave 2 已合并；T6 去转口后 executor import 面已稳定）。分支 `mc/T15-fakes`，worktree `D:/code/wt-mc-T15`。
> 纯测试任务：给最复杂的 executor 队列逻辑补上行为级测试。与轨道 A 并行（不碰 world.ts/combat-coordinator 等生产代码）。

## 公共背景（必读）

- 你在 worktree 里工作：
  ```bash
  cd D:/code/live_by_ai/external/cortico-world-minecraft
  git worktree add D:/code/wt-mc-T15 -b mc/T15-fakes
  cd D:/code/wt-mc-T15
  ```
- 测试命令：`node --experimental-strip-types --test tests/*.test.ts`（基线全绿，完成时必须全绿）。
- 零新增 npm 依赖；单测禁止真实连接。
- 参考实现（**只读**）：`D:/code/live_by_ai/external/Amaidesu/tests/agents/minecraft_v1_fakes.py` —— `FakeMaicraft` 实现**全部工具的行为级替身**：目标返回 running，测试用 finish/ask/pause 推进并自动写事件流。这是"行为级 fake"（不是数据桩）的样板。对照现有 `tests/escape-sprint.test.ts` 的手写 FakeBot（数据级鸭子类型），你的任务是升级到行为级。

## 问题

executor.ts（5225 行任务队列执行器）+ skills 家族共 2 万余行**零测试**。现有 5 个测试全是叶子模块，没有可复用的 fake 基建，导致没人敢动 executor——这正是重构 world/executor 的最大风险敞口。

## 你的任务

1. **新建 `tests/fakes/botkit.ts`**：可复用的行为级 FakeBot 套件：
   - 在现有手写 fakeBot 基础上升级：inventory（可置入/取出的物品表）、equipment（可装备）、look/move 控制（记录意图而非真动）、实体表（可注册敌/友/中立实体并触发事件）、block 表（可查询+挖掘完成回调）；
   - **行为推进**：不是静态数据——`fake.tick()` / `fake.arrive()` / `fake.hit()` 这类主动推进方法，模拟异步结果回填（对应 Amaidesu fakes 的 finish/ask/pause 推进思路）；
   - 全部鸭子类型，`import type` 之外零 mineflayer 依赖。
2. **新建 `tests/executor-queue.test.ts`**：用 botkit 测 executor 队列核心语义（**只测队列行为，不测具体技能**）：
   - 入队/出队顺序、队列状态（QueueStatus/BlockedRecord——Wave 2 后直接从 executor import 本体）；
   - 技能失败分类：SkillBlocked/Aborted/SkillNoop 异常对队列的不同影响；
   - 抢占/恢复（如队列有该语义）；
   - 空队列、满队列边界。
   ≥ 15 用例。executor 内部状态经公开接口断言，不做白盒偷字段。
3. **文档化**：`tests/fakes/README.md` 说明 botkit 的能力清单与用法示例（后续 T13/后续测试都靠它）。

## 禁区

- **所有 `src/*.ts` 生产代码一行不改**（发现测不了=设计问题，写进报告给集成者，由轨道 A 后续处理，本卡不改生产代码）。
- `src/collectors/`（T10/T11 的）。
- `tests/collectors/`、`tests/escape-sprint.test.ts` 等既有测试文件（只读复用思路，不改它们）。

## 验收

1. 测试全绿（53+Wave1/2 新增+你的 ≥15）。
2. `git diff main --stat -- src` 为空（生产代码零改动，硬性）。
3. botkit 覆盖清单与 README 对得上。

## 交付

提交到分支，报告：botkit 能力清单、executor 测到的队列语义、测不了而报告给集成者的设计问题（这个清单很有价值，会进 Wave 4 输入）。**不要合并到 main**。
