# T3：ADR 决策档案建立

> 波次 1 / 并发组 C。依赖：W0 完成。分支 `mc/T3-adr`，worktree `D:/code/wt-mc-T3`。纯文档任务，零代码风险。

## 公共背景（必读）

- 你在 worktree 里工作：
  ```bash
  cd D:/code/live_by_ai/external/cortico-world-minecraft
  git worktree add D:/code/wt-mc-T3 -b mc/T3-adr
  cd D:/code/wt-mc-T3
  ```
- 项目：Cortico Minecraft world 扩展。本卡不跑测试（无代码改动），但要保证不碰任何 .ts 文件。
- 参考格式（**只读**）：`D:/code/live_by_ai/external/Amaidesu/docs/decisions/`——Nygard 格式 ADR（编号-标题.md，含"背景/决策/后果"三段 + 实现提交哈希）。挑 `014`、`038`、`040` 三篇看结构即可。

## 你的任务

**新建 `docs/decisions/`**，把散落各处、只活在会话记忆里的来之不易的结论沉淀为编号 ADR。至少写这几篇（素材已定位，读源文件提取）：

1. **`001-贴面墙缝补丁.md`**——素材：`src/ADAPT.md`（66 行）。1.21.11 服务端开始拒绝贴面包围盒位置，prismarine-physics AABB 削移动量导致每刻静默传送回，修法是 `mineflayer-fixes.ts` 的 `installWallGap()` 留 1e-5 缝隙。把"如何用位置包量化新版本差异"的方法论也写进去。
2. **`002-弹幕注入通道.md`**——素材：`src/danmaku-inject.ts` + `src/definition.ts` 弹幕事件声明。为什么在引擎子进程内起 0.0.0.0:9883 HTTP（局域网限源+可选 key）、批攒 150ms/上限条数、投成 `minecraft.danmaku` 事件的设计取舍。**把隐藏运维面变成正式档案**。
3. **`003-生存红线机械闸.md`**——素材：`src/ENV_PROMPT.md` 的三条红线 + `src/constraint.ts` 机械闸（夜里出门 24 格直接拒单）。决策：为什么闸在代码不在提示词（LLM 不可靠）、为什么血线 13。
4. **`004-重连退避统一.md`**——预留骨架：并行任务 T1 正在把三处裸重试换成指数退避（参考 Amaidesu maxExponent=30 防浮点溢出的教训）。写背景与决策，实现哈希留"待 T1 合并后回填"。
5. **`README.md`**（decisions 目录内）：ADR 写作规范（何时写、格式、编号规则、与 git 提交哈希关联的要求）。

## 禁区

- 所有 `src/*.ts`、`tests/*.ts`（一个都不碰——本卡是纯文档卡）。
- `docs/refactor-plan/`（总计划的，别动）。
- 注意：T2 可能也在并行动 `src/ENV_PROMPT.md`，你**只读引用**它，不修改。

## 验收

1. `git diff --name-only main` 全部在 `docs/decisions/` 下。
2. 每篇 ADR 有"背景/决策/后果"三段结构。
3. `src/` 与 `tests/` 零改动（`git diff main --stat -- src tests` 输出为空）。

## 交付

提交到分支，报告：写了几篇、每篇一句话摘要。**不要合并到 main**。
