# AF3 Auto Submitter

AF3 Auto Submitter 是一个用于 AlphaFold Server 的 Tampermonkey 脚本。它可以批量提交 Saved Drafts、克隆并重新提交 Failed 任务，并在结果列表中辅助记录已下载任务。

## 文件说明

- `af3-auto-submitter.js`: 正式版 userscript，用于 main / Greasy Fork 发布。
- `af3-auto-submitter.dev.user.js`: 测试版 userscript，用独立的脚本名称、namespace 和面板 id，避免覆盖正式版安装。
- `index.html`: 中文安装和使用说明页面。
- `init.png`, `saved_draft.png`, `failed.png`: `index.html` 使用的说明截图。

## 当前功能

- 自动识别 Saved Drafts 和 Failed 页面。
- 批量提交 Saved Drafts，运行前会显示安全摘要。
- Clone and reuse Failed 任务并重新提交。
- 运行中支持暂停、继续、停止。
- 面板内提供可折叠日志。
- 拖动后的面板位置会保存在浏览器本地。
- 在结果/任务行上显示轻量标签：已下载、pTM、ipTM。

## 下载记录

下载记录保存在浏览器本地 `localStorage`，不会上传到服务器。脚本会在检测到 Download、mmCIF/CIF、JSON、model data 等下载相关点击时，把对应任务记录为已下载。

如果自动识别没有命中，每个被识别的任务行也会显示一个小的“标记下载/取消标记”按钮，方便手动修正。记录 key 会优先使用任务链接，其次使用行上的 data/id 属性，最后才使用行文本 hash。浏览器本地最多保留最近 500 条记录。

## pTM / ipTM 标签

如果 AlphaFold Server 的结果列表 DOM 中已经包含 pTM 或 ipTM 文本，脚本会直接在该行显示 `ipTM 0.82`、`pTM 0.74` 这类标签。当前脚本不会主动打开每个详情页抓取分数；如果列表 DOM 本身没有这些分数，就无法在列表中推断。

## 安全测试流程

新功能先推送到测试分支，不直接进 main：

1. 推送到 `test/greasyfork-dev-v2.2`。
2. 从下面的 raw URL 安装或更新 DEV 脚本：
   `https://raw.githubusercontent.com/siyuanj/af3-auto-submitter/test/greasyfork-dev-v2.2/af3-auto-submitter.dev.user.js`
3. 在 Tampermonkey 中禁用正式版脚本，只启用 DEV 脚本。
4. 用少量真实 AlphaFold Server 任务测试提交、失败重跑、下载记录、分数标签。
5. DEV 版确认稳定后，再合并到 `main`，让 Greasy Fork 同步正式版。

## 开发检查

提交前至少运行语法检查：

```bash
node --check af3-auto-submitter.js
node --check af3-auto-submitter.dev.user.js
```

涉及 UI 的修改建议再做一次浏览器 smoke test，确认面板、行级标签、手动下载标记和 DEV 更新元数据正常。
