# dsh-batch-update

DSH 插件页「更新」标签：批量检查可更新插件，勾选后逐个更新，**更新前先备份、失败自动从备份恢复、成功或恢复后删除备份**。

## 它做什么

- **刷新并检查**：读宿主 `pluginManager.listBundles()` 里 `updatable` 的包，逐个 `listVersions()` 查注册表新版本（口径与官方一致：最新、声明 bundle、兼容当前 DSH、非废弃、非预发布）。
- **选择更新源**：全局默认源 + 每行覆盖，来自宿主 `registries()`。
- **任务式更新**：勾选后串行执行 `updateBundle(name, to, { registry, requestId })`，每行实时显示 备份旧版 → 校验目标 → 卸载旧版 → 安装新版 → 回滚旧版 的进度。
- **失败自动恢复（备份式）**：
  1. 更新前把整个插件目录复制到 `$DSH_HOME/dsh-batch-update/backups/<name>/`（宿主半边同源路由 `/batch-update/backup`）；备份失败就**跳过该插件的更新**，不让插件处于无保护状态。
  2. 更新失败（含被取消）→ 自动把备份**纯本地拷回**（不查注册表、不联网，比宿主重装旧版快），状态显示「已回滚 · 已从备份恢复 <旧版>」。
  3. 成功或恢复完成后**删除备份**。
  4. 恢复也失败 → 保留备份、显示「回滚失败」，行上出现「重装旧版」按钮（先重试备份恢复，再退化到 `installBundle(name@from, {saveExact:true})` 联网兜底）。
  5. 若进程在更新中途崩溃留下备份，下次打开标签会列出「残留备份」并给一键清理按钮。
- **停止**：队列可随时停止；停止作用于当前之后的任务，当前任务可取消（`cancelInstall(requestId)`）。

## 边界

- `link:` / 本地来源的插件没有注册表新版本可言，直接排除在列表外。
- 更新必须串行：宿主安装共用同一把 pnpm 写锁，官方 UI 同一时刻也只跑一个更新。
- 备份是**目录级快照**（复制真实文件、解引用符号链接），不是回滚 npm 事务；`pnpm-lock.yaml` 与 `package.json` 的依赖声明由宿主 `updateBundle` 自身管理，不在本备份范围内。
- 部分更新（无 HMR 的包）需重启后生效，行尾会标注。

## 结构

- `index.js` 宿主半边：`/batch-update/backup` 同源 HTTP 路由，只接受本机请求，负责 create / restore / remove / list 备份。
- `client.js` 页面半边：`plugins.tab` 槽位注册「更新」标签，全部走宿主 RPC + 上面的备份路由，零 DOM 注入（仅注入自身 CSS）。

安装（link 方式）：

```
dsh plugin --profile desktop add link:C:/Users/Admin/.dsh/workspace/dsh-batch-update
```

装完重启 DSH 生效。
