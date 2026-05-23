# AF3 Auto Submitter

AF3 Auto Submitter 是一个用于 AlphaFold Server 的 Tampermonkey 脚本，主要用于批量提交 `Saved Drafts`，以及对 `Failed jobs` 执行 `Clone and reuse` 后重新提交。

当前正式版：`2.24`

- 安装入口：[Greasy Fork](https://greasyfork.org/zh-CN/scripts/563083-af3-auto-submitter-alphafold3-%E8%87%AA%E5%8A%A8%E6%8F%90%E4%BA%A4%E5%8A%A9%E6%89%8B)
- 正式版 raw URL：`https://raw.githubusercontent.com/siyuanj/af3-auto-submitter/main/af3-auto-submitter.js`
- 测试版 raw URL：`https://raw.githubusercontent.com/siyuanj/af3-auto-submitter/test/greasyfork-dev-v2.2/af3-auto-submitter.dev.user.js`

## 主要功能

- 自动识别 `Saved Drafts` 和 `Failed jobs` 页面，并切换对应运行模式。
- 批量提交 Saved Drafts，启动前显示安全摘要，避免误点过多任务。
- 对 Failed 任务自动点击 `Clone and reuse`，进入预览后重新提交。
- 运行中支持暂停、继续、停止。
- 批处理结束后弹出完成汇总，显示成功、跳过、失败数量，并列出最多 5 个跳过/失败任务及原因。
- 面板日志默认收起，需要排查时可展开查看。
- 面板可拖动，位置会保存在浏览器本地。
- 支持 6 种界面语言，默认中文：中文、English、日本語、한국어、Español、Français。

## 使用方式

1. 安装浏览器扩展 Tampermonkey。
2. 从 Greasy Fork 安装 AF3 Auto Submitter。
3. 打开 `https://alphafoldserver.com/` 或 `https://www.alphafoldserver.com/`。
4. 进入左侧菜单中的 `Saved Drafts` 或 `Failed jobs`。
5. 建议把页面底部的 `Rows per page` 设置为 `100`。
6. 在脚本面板里输入要处理的任务数量，然后点击启动。
7. 检查启动前安全摘要，确认后让浏览器保持前台运行。
8. 结束后查看完成汇总；如果有跳过或失败，可展开日志查看原因。

## 常见问题

**面板不显示**

- 确认 Tampermonkey 已启用，脚本已更新到 `2.24` 或更新版本。
- 确认浏览器允许 Tampermonkey 在 `alphafoldserver.com` 上运行。
- 刷新 AlphaFold Server 页面，必要时同时检查 `www.alphafoldserver.com` 域名。
- 如果使用 Edge / Chrome，请确认扩展权限和后台运行相关权限没有被关闭。

**运行中卡住**

- 先观察 AlphaFold 页面是否弹出了确认框、配额提示或网络错误。
- 可以用面板上的暂停、继续、停止控制当前批处理。
- 极少数情况下，如果页面弹窗没有被自动关闭，可以手动点一次页面上的确认按钮，脚本通常会继续检测并运行。

**Daily Quota 不足**

脚本会记录并跳过因为配额不足导致无法提交的任务。批处理结束时，完成汇总里会显示跳过数量和原因。

**正式版和测试版可以同时开吗**

不建议同时启用。测试 DEV 脚本时，请在 Tampermonkey 里禁用正式版，避免两个脚本同时操作页面。

## 文件说明

- `af3-auto-submitter.js`: 正式版 userscript，用于 `main` / Greasy Fork 发布。
- `af3-auto-submitter.dev.user.js`: 测试版 userscript，使用独立脚本名称、namespace 和面板 id，避免覆盖正式版安装。
- `index.html`: 中文安装和使用说明页面。
- `init.png`, `saved_draft.png`, `failed.png`: `index.html` 使用的说明截图。

## 开发和发布流程

新功能先进入测试分支，不直接发布到 `main`：

1. 在 `test/greasyfork-dev-v2.2` 上开发并推送。
2. 从测试版 raw URL 安装或更新 DEV 脚本。
3. 在 Tampermonkey 中禁用正式版，只启用 DEV 脚本。
4. 用少量真实 AlphaFold Server 任务测试语言切换、提交、失败重跑、完成汇总、暂停/继续/停止、日志展开和拖动位置保存。
5. DEV 版确认稳定后，再合并到 `main`，让 Greasy Fork 同步正式版。

提交前至少运行：

```bash
node --check af3-auto-submitter.js
node --check af3-auto-submitter.dev.user.js
git diff --check
```

涉及 UI 或页面操作的修改，建议再做一次浏览器 smoke test。
