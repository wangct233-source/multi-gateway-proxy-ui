# multi-gateway-proxy-ui · 0.1.0

独立纯静态 UI，无后端、无 npm、无 CDN。打开 `index.html`（或托管后访问），输入后端 BaseURL 与管理密码（默认 admin）。

- file:// 使用需要后端显式 `ALLOW_NULL_ORIGIN=true`。Origin:null 不可区分不同本地文件；不要在公网开放此配置。
- 更安全的本机方式：`python -m http.server 18081 --bind 127.0.0.1`，后端 `CORS_ORIGINS=http://127.0.0.1:18081`。
- 默认不保存密码；勾选保存会存入 localStorage，不是加密。共享电脑不要保存，结束后清除。
- UI 请求只调用真实后端 JSON API。任务默认 dry-run，`allowed:false` 不是成功；501 evidence_required 明确标为证据不足。
- 每网关账号添加仅提交 `env:VARIABLE_NAME`，真实密钥由后端环境配置。出口只读，绝不显示代理凭据。
- 配置公开 GitHub `owner/repo` 后，每次启动匿名检查 latest Release，只提示，不自动执行下载代码。
- /api/updates/check 会可能触发后端可信更新；UI 有明确确认提示，更新控制不在浏览器执行。

公共仓库 `wangct233-source/multi-gateway-proxy-ui` 已创建（main 已推送，匿名可读）；**GitHub Release 尚未发布**，Release 自动检查在真实 Release 发布前不会命中，也未做过真实 Release 端到端验收。
