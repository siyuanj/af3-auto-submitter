# AF3 Auto Submitter

AF3 Auto Submitter 是一个用于 AlphaFold Server 的 Tampermonkey 脚本。它可以批量提交 Saved Drafts、克隆并重新提交 Failed 任务，并在结果列表中辅助记录已下载任务。

## 文件说明

- `af3-auto-submitter.js`: 正式版 userscript，用于 main / Greasy Fork 发布。
- `af3-auto-submitter.dev.user.js`: 测试版 userscript，用独立的脚本名称、namespace 和面板 id，避免覆盖正式版安装。
- `index.html`: 中文安装和使用说明页面。
- `init.png`, `saved_draft.png`, `failed.png`: `index.html` 使用的说明截图。

## 当前功能

- 自动识别 Saved Drafts 和 Failed 页面。
- 支持 6 种界面语言，默认中文：中文、English、日本語、한국어、Español、Français。
- 批量提交 Saved Drafts，运行前会显示安全摘要。
- Clone and reuse Failed 任务并重新提交。
- 运行中支持暂停、继续、停止。
- 批处理结束后显示完成汇总，并列出跳过/失败的任务和原因。
- 面板内提供可折叠日志。
- 拖动后的面板位置会保存在浏览器本地。

## 安全测试流程

新功能先推送到测试分支，不直接进 main：

1. 推送到 `test/greasyfork-dev-v2.2`。
2. 从下面的 raw URL 安装或更新 DEV 脚本：
   `https://raw.githubusercontent.com/siyuanj/af3-auto-submitter/test/greasyfork-dev-v2.2/af3-auto-submitter.dev.user.js`
3. 在 Tampermonkey 中禁用正式版脚本，只启用 DEV 脚本。
4. 用少量真实 AlphaFold Server 任务测试语言切换、提交、失败重跑、完成汇总、暂停/继续/停止、日志展开和拖动位置保存。
5. DEV 版确认稳定后，再合并到 `main`，让 Greasy Fork 同步正式版。

## 开发检查

提交前至少运行语法检查：

```bash
node --check af3-auto-submitter.js
node --check af3-auto-submitter.dev.user.js
```

涉及 UI 的修改建议再做一次浏览器 smoke test，确认面板、语言切换、完成汇总、日志折叠、运行控制、拖动位置保存和 DEV 更新元数据正常。
