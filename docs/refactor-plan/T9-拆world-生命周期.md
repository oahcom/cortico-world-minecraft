# T9：拆 world.ts 第三刀——ServerLifecycle

> 波次 3 / 轨道 A（串行链 3/3）。依赖：**T8 已合并到 main**。分支 `mc/T9-lifecycle`，worktree `D:/code/wt-mc-T9`。
> ⚠️ 必须等 T8 合并后开工（同动 world.ts）。

## 公共背景（必读）

- 你在 worktree 里工作（**基线含 T7+T8 产物**）：
  ```bash
  cd D:/code/live_by_ai/external/cortico-world-minecraft
  git worktree add D:/code/wt-mc-T9 -b mc/T9-lifecycle
  cd D:/code/wt-mc-T9
  ```
- 测试命令：`node --experimental-strip-types --test tests/*.test.ts`（基线=T8 合并后全绿，完成时必须全绿）。
- 零新增 npm 依赖；单测禁止真实连接/开端口（MC 服务器生命周期用状态机单测，不真启停）。

## 问题

world.ts 兼管 MC 服务器生命周期（mcServer 相关字段：启停/重启/状态查询/`server-config.ts` 的调用）。这部分与 bot 行为无关，纯运维职责，是上帝对象里最容易被误碰的"隐藏运维面"（danmaku-inject 是另一个，归轨道 B 的 T10）。

## 你的任务

1. **盘点生命周期域成员**：mcServer 相关字段/方法、`server-config.ts` 消费点、启停/等待就绪逻辑。
2. **新建 `src/server-lifecycle.ts`**：`ServerLifecycle` 类——状态机（stopped→starting→running→stopping），动作方法（start/stop/restart/waitReady），构造器注入 `server-config` 数据与执行回调（**不 import world.ts**，不做真实进程管理——进程 spawn 逻辑原样从 world 搬过来，经注入的 spawn 函数调用，单测时可 fake）。
3. **world.ts 委托**：同 T7/T8 手法。
4. **新建 `tests/server-lifecycle.test.ts`**：状态机非法转换拒绝（stopped 时 stop 幂等、starting 中重复 start 拒绝）、waitReady 超时、重启序列。注入 fake spawn/poll。≥ 10 用例。
5. **顺手**：把 world.ts 头部残留的 mcServer 魔数（如有）对齐到 `server-config.ts`/`policy.ts`。

## 禁区

- `src/combat-coordinator.ts`、`src/goal-service.ts`（T7/T8 产物，只读）。
- `src/danmaku-inject.ts`、`src/bridge.ts`、`src/collectors/`、`tests/fakes/`（轨道 B 并行中）。
- `src/definition.ts`（宿主协议面，不碰）。

## 验收

1. 测试全绿。
2. `wc -l src/world.ts` ≤ 4000（本刀目标，也是 V3 的 world.ts < 4500 中间门）；若实际战斗/目标两刀搬得多，报告里说明偏差原因即可。
3. `git diff main --stat -- src/combat-coordinator.ts src/goal-service.ts` 为空。
4. server-lifecycle 无 world.ts import。

## 交付

提交到分支，报告：状态机设计、world.ts 前后行数、测试数。**不要合并到 main**。完成后提示集成者「轨道 A 收官，可做 V3 验收」。
