# T7：拆 world.ts 第一刀——CombatCoordinator

> 波次 3 / 轨道 A（串行链 1/3）。依赖：V2（Wave 2 已合并）。分支 `mc/T7-combat`，worktree `D:/code/wt-mc-T7`。
> ⚠️ 轨道 A 三张卡必须按 T7→T8→T9 顺序做，都动 world.ts 主体，并发必撞。

## 公共背景（必读）

- 你在 worktree 里工作：
  ```bash
  cd D:/code/live_by_ai/external/cortico-world-minecraft
  git worktree add D:/code/wt-mc-T7 -b mc/T7-combat
  cd D:/code/wt-mc-T7
  ```
- 测试命令：`node --experimental-strip-types --test tests/*.test.ts`（Wave 2 合并后基线全绿，完成时必须全绿）。
- 零新增 npm 依赖；单测禁止真实连接。

## 问题

`src/world.ts` 7172 行，`MinecraftWorld` 类（:2528 起）271 个 private 字段的上帝对象。本卡是**蚕食法第一刀**：只抽战斗协调，别贪。

## 你的任务

1. **盘点战斗域成员**：通读 MinecraftWorld 类，列出战斗相关的 private 字段与方法（线索：与 `combat.ts`/`melee.ts`/`ranged.ts`/`combat-context.ts` 交互的字段， reflex/combat 相关字段， HOSTILE 查询、武器选择、仇敌表等）。**先产出清单再动手**。
2. **新建 `src/combat-coordinator.ts`**：`CombatCoordinator` 类，构造器注入所需依赖（bridge 的 bot 获取器、策略配置、通知 emit 回调——**全部以接口/函数参数注入，禁止 import world.ts**，方向永远 world → coordinator 单向）。
3. **world.ts 委托**：删掉搬走的方法体，原调用点改成 `this.combat.xxx()`。公开面保持（world 对 executor/宿主的接口签名不变——查 `definition.ts` 声明的工具面是否引用这些行为，行为不能变）。
4. **新建 `tests/combat-coordinator.test.ts`**：用手写 FakeBot（参考 `tests/escape-sprint.test.ts` 的 fakeBot 手法）注入，覆盖：武器选择、仇敌增删、脱战条件。纯逻辑分支至少 10 用例。
5. **弹幕红线**：`world.ts:7128-7137` 的 injectDanmaku 与战斗无关，不碰。

## 禁区

- `src/deaths.ts` 等账本（Wave 2 已合，只读）。
- `src/danmaku-inject.ts`、`src/bridge.ts`、`src/collectors/`（轨道 B 并行中）。
- `src/executor.ts`（只读；如 executor 调用了 world 上被搬走的方法，保持 world 上的委托方法不动 executor）。

## 验收

1. 测试全绿。
2. `wc -l src/world.ts` ≤ 5700（搬走 ~1500 行）；`wc -l src/combat-coordinator.ts` > 1000。
3. `grep -c "import" src/combat-coordinator.ts` 无 world.ts 依赖（单向依赖成立）。
4. 行为不变验证：`git diff main --stat -- src/combat.ts src/melee.ts src/ranged.ts src/definition.ts` 为空（这些文件零改动）。

## 交付

提交到分支，报告：搬走的成员清单（字段/方法数）、world.ts 前后行数、测试数。**不要合并到 main**。
