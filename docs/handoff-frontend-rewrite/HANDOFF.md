# 前端重构交接（临时目录，合并前删除）

## 已完成并推送
- d54f607 启动延迟；51359a7 上下文摘要；2c4347e RuntimeStatus 增加 nextCycleArmedAt / nextCycleIsFirst。
- 本提交（WIP）：前端重构进行到一半，工作流在“Pages”阶段被暂停。typecheck 通过。

## 设计决定
- 基础方案：`designs/danmaku/`（mockup.html + spec.json）。
- 主色改为应用图标的 teal/cyan，coral 作为辅助色；品牌标识用真实图标（已在 `src/renderer/assets/`）。
- 嫁接 Fluent：每个设置都有可见说明，脏状态时显示“还原”，Ctrl+S 保存。
- 嫁接 Studio：缓存命中的小柱状图，日志行的标签。
- 配置方案放在侧边栏弹出框里（role=dialog）。
- 详细要求见 `workflow-resume.js` 中的 CONTEXT 和每页的 task 文本。

## 当前进度（src/renderer/settings/）
| 部分 | 状态 |
|---|---|
| Foundation | 完成：tokens、组件、useSettingsController、外壳与 dock、预览数据 `?demo=running\|delay\|paused\|idle\|error`、窗口背景跟随 nativeTheme。API 说明见 `workflow-results/foundation.json` |
| Model / Character / Prompt 页 | 完成，见 `workflow-results/page-model-character-prompt.json` |
| Overview 页 | 写了大部分（743 行），agent 中途被停，需要检查并补完、截图核对 |
| Danmaku 页 + 弹幕层打磨 | 未开始（占位） |
| Rhythm / Capture 页 | 未开始（占位） |
| Logs 页 | 未开始（占位） |
| Review / Integrate | 未开始 |

## 如何继续
1. 跑剩下的阶段：
   `Workflow({scriptPath: "docs/handoff-frontend-rewrite/workflow-resume.js", args: {stages: ["pages","review","integrate"], pages: ["overview","danmaku-overlay","rhythm-capture","logs"]}})`
   也可以手动逐页完成，按脚本里每页的 task 文本做。
2. 预览：`npx vite --host 127.0.0.1 --port 5181`，然后 `node tools/shoot.cjs "http://127.0.0.1:5181/?demo=running#overview" out.png 1120 760 light 0`。
3. 收尾：
   - 跑 typecheck、test、build。
   - 用 `tools/e2e` 在 Xvfb 下做真实应用的端到端测试，Halogen 只做顺序小请求。
   - 更新 `docs/assets/settings.png` 和 README。
   - **删除本目录**。
   - 把 WIP 提交整理成主题提交（这个分支还没有开 PR）。
   - 开新 PR 到 main，正文以 `pr-body-draft.md` 为底稿。
4. 用户约束：
   - 测试网关地址不要写进代码和文档。
   - 鉴权由代理自动添加。
   - Halogen 是共享后端，不要并发压测。
