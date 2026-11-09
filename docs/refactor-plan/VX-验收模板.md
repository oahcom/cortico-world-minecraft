# VX：波次验收与合并（集成者用，每波次跑一遍）

> 使用者：集成者 AI（或用户本人）。每张派工卡明确"不要自己合并"——合并权集中在这里。
> 输入：本波次全部任务卡完成报告 + 分支列表。

## 验收流程

对每个波次（V1/V2/V3/V4），按序执行：

### 第 1 步：收卡检查（合并前）

对每个待合并分支（如 Wave 1 的 `mc/T1-backoff`/`mc/T2-policy`/`mc/T3-adr`）：

```bash
cd D:/code/live_by_ai/external/cortico-world-minecraft   # 主仓
git log --oneline mc/Tn-xxx | head -5          # 有提交
git diff main..mc/Tn-xxx --name-only           # 改动文件清单
```

逐张核对派工卡的"禁区"清单：**改动文件越界 = 打回**（让该卡 AI 在其 worktree 内修正后重新交付）。

### 第 2 步：逐分支合并（一次一个，合并一个测一次）

```bash
git checkout main
git merge mc/T1-backoff   # 按 README 派工总表的波次内顺序
node --experimental-strip-types --test tests/*.test.ts
```

- 测试红：小修（import 冲突、常量名对齐这类 <10 行的就地修，修完补提交）；大红打回整卡。
- **已知可预期的合并冲突点**（按计划推演）：
  - V2：T4 与 T6 都动 `src/world.ts`（T4 动账本接线区、T6 动文件头 import 区）——手工合并，两边都要保留。
  - V2：T5 改 readouts 的 import 时 T6 也可能扫到——以 T5 的直连版本为准。
  - 其余波次文件所有权不相交，理论零冲突；出现冲突即说明有卡越界，查明责任卡。

### 第 3 步：波次专项验收（合并完跑）

**V1（Wave 1 后）**
- `grep -rn "new ExponentialBackoff" src/` ≥ 2 处且成功路径有 `.reset()`
- `node --experimental-strip-types --test tests/prompt-consistency.test.ts` 单独可跑且绿
- `ls docs/decisions/` ≥ 5 文件
- `ls src/*.orig-danmaku` 报不存在

**V2（Wave 2 后）**
- `grep -c "^export.*from '\./" src/executor.ts` = 0
- 账本测试存在且绿：`node --experimental-strip-types --test tests/deaths.test.ts tests/works.test.ts`
- `ls src/notice-router.ts` 存在且有表驱动测试

**V3（Wave 3 后）**
- `wc -l src/world.ts` ≤ 4500（V3 门；轨道 A 三刀目标 4000，偏差需报告说明）
- `ls src/collectors/` 有 base + 两个 collector
- `ls tests/fakes/botkit.ts` 存在，executor 队列测试 ≥ 15 用例
- 弹幕链路行为对照（对照 T10 报告的清单逐项核对代码仍成立）

**V4（Wave 4 后，终验）**
- `wc -l src/world.ts` ≤ 2000（最终门）
- `ls src/` 出现分层目录，平铺文件 ≤ 6
- 上下文分层测试 + live-gate 测试绿
- 全量测试一次全绿
- `node --experimental-strip-types -e "import('./src/index.ts').then(()=>console.log('OK'))"` OK

### 第 4 步：清场

```bash
git worktree remove D:/code/wt-mc-Tn
git branch -d mc/Tn-xxx
git log --oneline | head -10   # 记录波次锚点 commit
```

### 第 5 步：台架冒烟（用户手动，AI 不做）

波次验收后提醒用户：直播台架连 192.168.1.97 实测一次（弹幕注入→行为→日志 lane），单测覆盖不了真实 mineflayer 行为。**V1/V3/V4 后建议各做一次**。

## 产出

验收报告：合并了哪些分支、冲突处理记录、专项验收逐项结果、波次锚点 hash、打回记录（如有）。
