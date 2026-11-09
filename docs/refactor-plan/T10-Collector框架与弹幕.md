# T10：Collector 框架 + 弹幕流迁移

> 波次 3 / 轨道 B（并发组 B1，不碰 world.ts 主体）。依赖：V2（Wave 2 已合并）。分支 `mc/T10-collector`，worktree `D:/code/wt-mc-T10`。
> 轨道 B 与轨道 A（T7/T8/T9 拆 world.ts）**并行**，靠"不碰 world.ts"这条纪律保证不撞。

## 公共背景（必读）

- 你在 worktree 里工作：
  ```bash
  cd D:/code/live_by_ai/external/cortico-world-minecraft
  git worktree add D:/code/wt-mc-T10 -b mc/T10-collector
  cd D:/code/wt-mc-T10
  ```
- 测试命令：`node --experimental-strip-types --test tests/*.test.ts`（基线全绿，完成时必须全绿）。
- 零新增 npm 依赖；单测禁止真实连接/开端口（弹幕 collector 测试用注入的 fake emit/HTTP handler）。
- 参考实现（**只读**，已人工通读验证过，直接照这个模式做）：
  `D:/code/live_by_ai/external/Amaidesu/src/modules/collectors/base.py` —— 生命周期状态机 + collect() 生成器 + 基类后台消费 + 异常隔离 + emit 封装。参考 ADR：`docs/decisions/038-*.md`（附属采集器：流的生命周期独立于消费者实例，防重建漏事件）。

## 问题

cortico 的事件源各写各的：`danmaku-inject.ts`（210 行，子进程内 0.0.0.0:9883 HTTP 服务器 + 裸 setTimeout 重启 + 手工攒批）是"隐藏运维面"，bridge/chat/死亡事件又是另一套写法。生命周期、启停、异常隔离语义不统一。

## 你的任务

1. **新建 `src/collectors/base.ts`**——TS 版 BaseCollector（对应 Amaidesu 模式）：
   - 状态机 `'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'errored'`，start/stop 校验状态、锁保护（TS 单线程，简单互斥即可）；
   - `collect(): AsyncIterable<void>` 协议——子类在内部自行调 `this.emit(name, payload)`；
   - 基类后台任务消费 collect() 迭代并**隔离异常**（单轮异常记日志进 errored 态，不炸进程）；
   - `emit` 构造器注入（`(name: string, payload: unknown) => void`），bus 为空安全跳过。
2. **新建 `src/collectors/danmaku-collector.ts`**：把 `danmaku-inject.ts` 的 HTTP 服务器+攒批逻辑迁成 collector 实现。**对外行为不变**：端口 9883、批窗口、上限条数、`[danmaku-inject]` 日志前缀、局域网限源。
3. **danmaku-inject.ts 变薄壳**：保留导出的启动函数，内部 new DanmakuCollector；对 `world.injectDanmaku()`（world.ts:7128-7137）的调用经注入回调，**world.ts 一行不改**。
4. **退避接入**：服务器重启改用 Wave 1 合入的 `src/backoff.ts`（T1 已把裸 setTimeout 换成 backoff；迁移时保留这个语义，listening 成功 reset）。
5. **新建 `tests/collectors/base.test.ts` + `tests/collectors/danmaku.test.ts`**：状态机转换/非法转换、collect 异常隔离（抛错的子类不炸基类消费循环）、fake HTTP 注入→emit 序列、批窗口聚合。≥ 15 用例。

## 禁区（其他 AI 并行在改）

- `src/world.ts`（轨道 A 正在拆，你一行都不碰——弹幕注入到 world 的接口保持原样）。
- `src/bridge.ts`（T11 的）。
- `tests/fakes/`（T15 的）。
- `src/executor.ts`、`src/combat-coordinator.ts` 等轨道 A 领域。

## 验收

1. 测试全绿（含新增 collector 测试）。
2. `git diff main --stat -- src/world.ts` 为空（硬性）。
3. `grep -n "0.0.0.0" src/collectors/danmaku-collector.ts` 命中且 `grep -n "injectDanmaku" src/collectors/danmaku-collector.ts` 经注入回调无直接 world import。
4. 弹幕链路行为不变清单（端口/批窗/上限/日志前缀）逐项在报告里打勾。

## 交付

提交到分支，报告：框架接口定义、弹幕迁移前后行为对照表、测试数。**不要合并到 main**。完成后提示集成者「T11 可以开工（依赖本卡框架）」。
