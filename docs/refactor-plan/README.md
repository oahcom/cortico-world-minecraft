# Minecraft World 扩展重构总计划（多 AI 并发作业）

> 2026-11-09 制定。目标项目：`D:/code/live_by_ai/external/cortico-world-minecraft`（下称"项目"）。
> 依据：`docs/` 同级调研报告《2026-11-09-minecraft-world-architecture-port-from-amaidesu.md》（在 `D:/code/live_by_ai/docs/`）。
> 用法：把本目录下的派工卡（`W0`/`T1`~`T15`/`VX`）逐张交给不同 AI 会话执行。每张卡自洽，无需其他上下文。

---

## 一、并发模型

1. **项目内建独立 git 仓**（现状：整个目录 untracked，无任何版本控制——`.orig-danmaku` 手工备份就是这个的产物）。W0 负责建仓+基线提交。
2. **每个任务 = 一个分支 + 一个 git worktree**（`D:/code/wt-mc-<编号>`）。多个 AI 在各自 worktree 里同时改代码，互不干扰，完成后由集成者合并。
3. **文件所有权分区**：每张派工卡声明"你的文件"与"禁区"（其他 AI 正在改的文件）。触碰禁区 = 派工卡作废，集成者有权打回。
4. 波次内有依赖的任务必须串行（派工卡标注了依赖）。

## 二、波次与依赖图

```
W0 建仓+基线（串行，集成者）
 │
 ├─ Wave 1（3 并发）───────────────────── V1 验收合并
 │   T1 统一退避重连   T2 提示词常量收口   T3 ADR决策档案
 │
 ├─ Wave 2（3 并发）───────────────────── V2 验收合并
 │   T4 账本纯函数化   T5 通知路由表   T6 executor去转口
 │
 ├─ Wave 3（双轨道）───────────────────── V3 验收合并
 │   轨道A(串行链,动world.ts主体): T7拆战斗 → T8拆目标 → T9拆生命周期
 │   轨道B(并发,不碰world.ts):     T10 Collector框架+弹幕  T11 bridge迁移  T15 行为级fakes
 │
 └─ Wave 4（串行链）───────────────────── V4 终验
     T13 上下文分层 → T14 live gate → T12 目录重构（最后做,纯移动）
```

## 三、派工总表

| 卡 | 波次 | 并发组 | 核心产出 | 分支 | 预估规模 |
|----|------|--------|----------|------|----------|
| W0 | 0 | 独占 | git 仓+基线提交+删漂移备份 | main | 2 commits |
| T1 | 1 | A | `src/backoff.ts` + 三处重连统一 | mc/T1-backoff | ~150 行 |
| T2 | 1 | B | `src/policy.ts` + 提示词一致性测试 | mc/T2-policy | ~200 行 |
| T3 | 1 | C | `docs/decisions/` ADR 档案 | mc/T3-adr | 纯文档 |
| T4 | 2 | A | 账本五文件纯函数化+测试 | mc/T4-ledger | ~800 行 |
| T5 | 2 | B | `src/notice-router.ts` 路由表 | mc/T5-notice | ~400 行 |
| T6 | 2 | C | executor 删转口+调用方直连 | mc/T6-deexport | ~100 行改动 |
| T7 | 3 | A1 | `src/combat-coordinator.ts`（world.ts 拆解第一刀） | mc/T7-combat | ~1500 行位移 |
| T8 | 3 | A2 | `src/goal-service.ts`（依赖 T7 已合并） | mc/T8-goals | ~1000 行位移 |
| T9 | 3 | A3 | `src/server-lifecycle.ts`（依赖 T8 已合并） | mc/T9-lifecycle | ~800 行位移 |
| T10 | 3 | B1 | `src/collectors/` 框架+弹幕迁移 | mc/T10-collector | ~400 行 |
| T11 | 3 | B2 | bridge 事件流迁 collector（依赖 T10 框架先合并） | mc/T11-bridge-collector | ~300 行 |
| T15 | 3 | B3 | `tests/fakes/` 行为级替身+executor 队列测试 | mc/T15-fakes | ~600 行 |
| T13 | 4 | 链1 | `src/context-layers.ts` 上下文四层 | mc/T13-context | ~500 行 |
| T14 | 4 | 链2 | `src/live-gate.ts` 直播模式闸（依赖 T13） | mc/T14-livegate | ~250 行 |
| T12 | 4 | 链3 | 目录分层重构（最后，纯移动+import 重写） | mc/T12-restructure | 全库位移 |

## 四、全局不变量（所有卡共同的红线）

1. **测试命令**：`node --experimental-strip-types --test tests/*.test.ts`（node v22.22.2，基线 53 用例全绿）。任何卡完成时必须全绿。
2. **零新增 npm 依赖**（package.json 无 runtime 依赖，保持）。
3. **单测禁止真实连接**：不 import mineflayer 运行时、不连 192.168.1.97、不开端口。一律手写鸭子类型 Fake。
4. **弹幕链路不能回退**：`danmaku-inject.ts` 的 0.0.0.0:9883 注入、`world.ts:7128-7137` 的 `injectDanmaku()` 是直播关键路径，行为保持。
5. **`describe.json`/`package.json` 的 cortico 协议字段（kind/api）不动**（除非卡里明说）。
6. 提交信息中文、动词开头；一个任务一个分支；分支上可以多个小提交。
7. worktree 用完即删（`git worktree remove`），主仓 `D:/code/live_by_ai/external/cortico-world-minecraft` 只做合并，不做开发。

## 五、集成规程（验收卡 VX 执行）

1. 一波内按派工总表顺序逐分支合并：`git merge mc/Tn-xxx`（worktree 内开发，主仓合并）。
2. 每合并一个分支跑一次全量测试；红了就地修或打回该卡。
3. 全部合并后跑验收卡里的专项检查（wc -l 预算、grep 不变量、禁区审计）。
4. `git worktree remove D:/code/wt-mc-<编号> && git branch -d mc/Tn-xxx`。
5. 出问题回滚：`git reset --hard <合并前commit>`（W0 建仓后 main 上每个波次结束都有干净锚点）。

## 六、每张卡的公共背景块（已内嵌，此处备查）

- 项目形态：宿主 Cortico fork 引擎子进程（`engine-child.ts`），子进程内建 `MinecraftWorld`（`world.ts:2528` 起，现 7172 行，271 个 private 字段——本重构就是拆它）。
- 参考框架（**只读**）：`D:/code/live_by_ai/external/Amaidesu`（Python，抄模式不抄代码）。
- 代码风格：中文注释、现有文件的无分号/单引号风格、魔数集中在用到处头部——重构目标是反向（集中到 policy/config）。
- 环境：Windows + git-bash，路径用正斜杠。远端 MC 服务器 192.168.1.97 与单测无关。

## 七、验收里程碑

| 门 | 标准 |
|----|------|
| V1 | 重连退避生效（日志可见 backoff 序列）；ENV_PROMPT 数字与代码常量一致性测试在跑；ADR 目录建立 |
| V2 | 账本有测试；executor 无一行 re-export；通知加行不改代码 |
| V3 | world.ts < 4500 行；弹幕/bridge 走统一 Collector；executor 队列有行为级测试 |
| V4 | world.ts < 2000 行；上下文分层落地 token 可测；目录分层完成；全部测试绿 |
