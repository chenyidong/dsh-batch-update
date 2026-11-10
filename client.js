/**
 * 插件批量更新 —— 页面半边。
 *
 * 在官方插件页注册一个「更新」标签（plugins.tab 槽位，官方 Discover 标签同源）。
 * 全部走宿主 pluginManager 的 remote RPC，零 DOM 注入：
 *
 *   listBundles()   -> 哪些 bundle 可更新（updatable 标志，与官方同一语义）
 *   listVersions()  -> 查注册表新版本（updateBundle 之前官方也做这一步）
 *   registries()    -> 可用更新源
 *   updateBundle()  -> 更新单个包
 *   installBundle() -> 「重装旧版」最终兜底：连备份都恢复不了时联网重装
 *   cancelInstall() -> 停止队列
 *
 * 回滚走「更新前备份」：宿主半边 /batch-update/backup 路由（同源 HTTP）负责
 * create / restore / remove，备份放 $DSH_HOME 下、纯本地拷回，不查注册表，
 * 比宿主联网重装旧版快。成功或恢复完成后删除备份，只留中断残留供清理。
 *
 * 更新必须串行：宿主安装走同一把 pnpm 写锁，官方 UI 也是同一时刻只跑一个。
 */
window.__ModuleLoader__.load({
  id: 'dsh-batch-update',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const STEP_TEXT = {
      backup: '备份旧版', checking: '校验目标', removing: '卸载旧版',
      installing: '安装新版', restoring: '回滚旧版', cleanup: '清理备份',
    }
    const DEFAULT_REGISTRY_LABEL = 'pnpm 默认配置'

    /** 宿主备份路由：更新前 create、失败 restore、成功/恢复后 remove。 */
    async function backupCall(action, name, extra) {
      const res = await fetch('/batch-update/backup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, name, ...extra }),
      })
      const body = await res.json()
      if (!body.ok) throw new Error(body.error || '备份操作失败')
      return body
    }

    /** 列出崩溃/中断遗留的备份，供手动清理。 */
    async function loadBackups() {
      try {
        const res = await fetch('/batch-update/backup', { cache: 'no-store' })
        const body = await res.json()
        if (body.ok) patch({ leftovers: body.backups || [] })
      } catch (_) {}
    }

    async function clearLeftovers() {
      for (const b of snapshot.leftovers) {
        try { await backupCall('remove', b.name) } catch (_) {}
      }
      await loadBackups()
    }

    /* 样式一次注入：用 currentColor + color-mix，跟随 DSH 主题深浅色。 */
    const CSS_ID = 'dsh-batch-update-css'
    const CSS = `
.dbu-wrap{display:flex;flex-direction:column;gap:12px;padding:6px 2px 24px;font-size:13px;line-height:1.5}
.dbu-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:10px;background:color-mix(in srgb,currentColor 3%,transparent);position:sticky;top:0;z-index:2;backdrop-filter:blur(6px)}
.dbu-spacer{flex:1 1 auto}
.dbu-btn{appearance:none;border:1px solid color-mix(in srgb,currentColor 20%,transparent);background:color-mix(in srgb,currentColor 5%,transparent);color:inherit;font:inherit;padding:5px 13px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:background .15s,border-color .15s,opacity .15s}
.dbu-btn:hover:not(:disabled){background:color-mix(in srgb,currentColor 11%,transparent);border-color:color-mix(in srgb,currentColor 32%,transparent)}
.dbu-btn:disabled{opacity:.45;cursor:default}
.dbu-btn.primary{background:color-mix(in srgb,currentColor 15%,transparent);border-color:color-mix(in srgb,currentColor 38%,transparent);font-weight:600}
.dbu-btn.small{padding:3px 9px;font-size:12px;border-radius:7px}
.dbu-field{display:inline-flex;align-items:center;gap:6px;color:color-mix(in srgb,currentColor 62%,transparent);white-space:nowrap}
.dbu-group{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
.dbu-sep{width:1px;align-self:stretch;margin:3px 3px;background:color-mix(in srgb,currentColor 14%,transparent);flex:0 0 auto}
.dbu-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);background:color-mix(in srgb,currentColor 3%,transparent);color:color-mix(in srgb,currentColor 66%,transparent);font-size:12px;cursor:pointer;user-select:none;white-space:nowrap;transition:background .15s,border-color .15s,color .15s}
.dbu-chip:hover:not(:has(input:disabled)){background:color-mix(in srgb,currentColor 9%,transparent);border-color:color-mix(in srgb,currentColor 28%,transparent)}
.dbu-chip.on{background:color-mix(in srgb,currentColor 14%,transparent);border-color:color-mix(in srgb,currentColor 36%,transparent);color:inherit;font-weight:600}
.dbu-chip:has(input:disabled){opacity:.45;cursor:default}
.dbu-ico{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;font-size:13px;line-height:1;opacity:.7}
.dbu-btn.icon{padding-left:9px;display:inline-flex;align-items:center;gap:6px}
.dbu-select{appearance:none;-webkit-appearance:none;border:1px solid color-mix(in srgb,currentColor 18%,transparent);background:color-mix(in srgb,currentColor 4%,transparent);color:inherit;font:inherit;font-size:12.5px;line-height:1.4;padding:5px 26px 5px 10px;border-radius:8px;max-width:210px;cursor:pointer;text-overflow:ellipsis;transition:background .15s,border-color .15s,box-shadow .15s;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 13px) 50%,calc(100% - 8px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.dbu-select:hover:not(:disabled){background-color:color-mix(in srgb,currentColor 9%,transparent);border-color:color-mix(in srgb,currentColor 30%,transparent)}
.dbu-select:focus-visible{outline:none;border-color:color-mix(in srgb,currentColor 45%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,currentColor 12%,transparent)}
.dbu-select:disabled{opacity:.5;cursor:default}
.dbu-select option{color:inherit}
.dbu-dd{position:relative;display:inline-flex;flex:0 0 auto}
.dbu-dd-trigger{display:block;width:100%;text-align:left}
.dbu-menu{position:absolute;top:calc(100% + 5px);left:0;z-index:30;min-width:100%;max-width:360px;max-height:260px;overflow:auto;padding:5px;border-radius:10px;border:1px solid rgba(0,0,0,.12);background:#fff;box-shadow:0 10px 30px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:2px}
.dbu-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;background:transparent;color:inherit;font:inherit;font-size:12.5px;padding:7px 9px;border-radius:7px;cursor:pointer;line-height:1.35}
.dbu-item:hover{background:rgba(0,0,0,.05)}
.dbu-item.on{background:rgba(29,78,216,.12);font-weight:600}
.dbu-item-main{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dbu-item-hint{flex:0 0 auto;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:.55;font-family:ui-monospace,Consolas,Menlo,monospace}
.dbu-item-tick{flex:0 0 auto;opacity:.75;font-size:11px}
@media (prefers-color-scheme:dark){
.dbu-menu{background:#1e1e21;border-color:rgba(255,255,255,.14);box-shadow:0 10px 30px rgba(0,0,0,.55)}
.dbu-item:hover{background:rgba(255,255,255,.07)}
.dbu-item.on{background:rgba(96,165,250,.18)}
}
.dbu-check{width:15px;height:15px;margin:0;cursor:pointer;accent-color:color-mix(in srgb,currentColor 65%,transparent)}
.dbu-check:disabled{cursor:default}
.dbu-progress{height:3px;border-radius:2px;background:color-mix(in srgb,currentColor 9%,transparent);overflow:hidden}
.dbu-progress::after{content:"";display:block;height:100%;width:36%;border-radius:2px;background:currentColor;opacity:.55;animation:dbu-slide 1.2s ease-in-out infinite}
@keyframes dbu-slide{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}
.dbu-note{padding:8px 12px;border-radius:8px;font-size:12px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 4%,transparent)}
.dbu-note.err{color:#b91c1c;border-color:rgba(185,28,28,.3);background:rgba(185,28,28,.07)}
.dbu-list{display:flex;flex-direction:column;gap:8px}
.dbu-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid color-mix(in srgb,currentColor 11%,transparent);border-radius:10px;background:color-mix(in srgb,currentColor 2%,transparent);transition:background .15s,border-color .15s}
.dbu-row:hover{background:color-mix(in srgb,currentColor 5%,transparent);border-color:color-mix(in srgb,currentColor 20%,transparent)}
.dbu-row.on{border-color:color-mix(in srgb,currentColor 30%,transparent);background:color-mix(in srgb,currentColor 6%,transparent)}
.dbu-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.dbu-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dbu-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;color:color-mix(in srgb,currentColor 55%,transparent)}
.dbu-pkg{font-family:ui-monospace,Consolas,Menlo,monospace}
.dbu-ver{font-family:ui-monospace,Consolas,Menlo,monospace;padding:1px 6px;border-radius:5px;background:color-mix(in srgb,currentColor 8%,transparent);color:color-mix(in srgb,currentColor 75%,transparent)}
.dbu-ver.new{background:rgba(29,78,216,.14);color:#1d4ed8;font-weight:600}
.dbu-arrow{opacity:.5}
.dbu-err{font-size:12px;color:#b91c1c;word-break:break-word}
.dbu-tag{display:inline-flex;align-items:center;gap:5px;padding:2px 10px;border-radius:999px;font-size:12px;white-space:nowrap;border:1px solid transparent;flex:0 0 auto}
.dbu-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:0 0 auto}
.dbu-tag.ok{color:#15803d;background:rgba(21,128,61,.1);border-color:rgba(21,128,61,.22)}
.dbu-tag.bad{color:#b91c1c;background:rgba(185,28,28,.1);border-color:rgba(185,28,28,.22)}
.dbu-tag.warn{color:#b45309;background:rgba(180,83,9,.1);border-color:rgba(180,83,9,.22)}
.dbu-tag.info{color:#1d4ed8;background:rgba(29,78,216,.1);border-color:rgba(29,78,216,.22)}
.dbu-tag.busy{color:#0e7490;background:rgba(14,116,144,.1);border-color:rgba(14,116,144,.22)}
.dbu-tag.muted{color:color-mix(in srgb,currentColor 55%,transparent);background:color-mix(in srgb,currentColor 6%,transparent);border-color:color-mix(in srgb,currentColor 13%,transparent)}
.dbu-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:56px 16px;border:1px dashed color-mix(in srgb,currentColor 16%,transparent);border-radius:12px;color:color-mix(in srgb,currentColor 50%,transparent);text-align:center}
.dbu-empty strong{font-weight:600;font-size:13px;color:color-mix(in srgb,currentColor 78%,transparent)}
@media (prefers-color-scheme:dark){
.dbu-tag.ok{color:#4ade80;background:rgba(74,222,128,.12);border-color:rgba(74,222,128,.25)}
.dbu-tag.bad{color:#f87171;background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.25)}
.dbu-tag.warn{color:#fbbf24;background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.25)}
.dbu-tag.info{color:#60a5fa;background:rgba(96,165,250,.12);border-color:rgba(96,165,250,.25)}
.dbu-tag.busy{color:#22d3ee;background:rgba(34,211,238,.12);border-color:rgba(34,211,238,.25)}
.dbu-ver.new{background:rgba(96,165,250,.16);color:#60a5fa}
.dbu-err{color:#f87171}
.dbu-note.err{color:#f87171;border-color:rgba(248,113,113,.3);background:rgba(248,113,113,.08)}
}`

    function ensureCss() {
      try {
        if (document.getElementById(CSS_ID)) return
        const el = document.createElement('style')
        el.id = CSS_ID
        el.textContent = CSS
        document.head.appendChild(el)
      } catch (_) {}
    }

    /* ---------------------------------------------------------------- store */

    let snapshot = {
      phase: 'idle', // idle | loading | ready
      rows: [],
      busy: false,
      stop: false,
      active: null, // { name, requestId } —— 正在跑的那一行
      registries: [null], // URL 字符串或 null（= pnpm 默认）
      globalRegistry: null,
      summary: null, // 一轮队列跑完后的统计
      error: '',
      leftovers: [], // 上次崩溃/中断残留的备份
    }
    const listeners = new Set()
    function patch(next) {
      snapshot = { ...snapshot, ...next }
      for (const fn of listeners) fn()
    }
    function subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
    const getSnapshot = () => snapshot
    function patchRow(name, next) {
      patch({ rows: snapshot.rows.map((r) => (r.name === name ? { ...r, ...next } : r)) })
    }
    const getRow = (name) => snapshot.rows.find((r) => r.name === name)

    /* ------------------------------------------------------------------- rpc */

    let ctx = null
    const ok = (answer, fallback) => (answer && answer.ok ? answer.value : (patch({ error: answer?.error?.message || fallback }), null))

    async function load() {
      patch({ phase: 'loading', error: '' })
      try {
        const bundles = ok(await ctx.remote.pluginManager.listBundles(), '读取插件列表失败')
        if (!bundles) return patch({ phase: 'ready' })
        const rows = bundles
          .filter((b) => b.updatable === true && b.installed)
          // link:/file: 来源的本地插件没有「注册表新版本」可言，跳过
          .filter((b) => !String(b.installTarget?.spec ?? b.source ?? '').startsWith('link:'))
          .map((b) => ({
            name: b.name,
            title: b.meta?.displayName || b.name,
            enabled: b.enabled === true,
            from: typeof b.version === 'string' ? b.version : typeof b.installed === 'string' ? b.installed : '',
            to: '',
            listRegistry: null,
            check: 'todo', // todo | checking | ready | none | refused
            registryOverride: null,
            task: null, // { phase, step, error, restart }
            selected: false,
          }))
        patch({ phase: 'ready', rows })
      } catch (err) {
        patch({ phase: 'ready', error: `读取插件列表失败：${err?.message || err}` })
      }
    }

    async function readRegistries() {
      try {
        const value = ok(await ctx.remote.pluginManager.registries(), '')
        const list = value ? [value.registry, ...(value.fallbackRegistries || []), null] : [null]
        patch({ registries: [...new Set(list)] })
      } catch (_) {}
    }

    /** 逐行查新版本（串行，一次只打一个包的注册表，与官方 checkAllVersions 同策略）。 */
    async function checkAll() {
      for (const row of [...snapshot.rows]) {
        if (snapshot.stop) break
        patchRow(row.name, { check: 'checking' })
        const answer = await ctx.remote.pluginManager.listVersions(row.name, {})
        if (!answer.ok) {
          patchRow(row.name, { check: 'refused', task: null, error: answer.error.message })
          continue
        }
        const list = answer.value
        if (list.status !== 'listed') {
          patchRow(row.name, { check: 'refused', error: list.reason || '注册表拒绝返回版本列表' })
          continue
        }
        // 与官方 updateCandidate 同口径：最新、声明 bundle、兼容当前 DSH、非废弃、非预发布
        const cand = list.versions.find((v) => v.bundle && v.incompatible === undefined && v.deprecated === undefined && !v.prerelease)
        patchRow(row.name, {
          check: cand ? 'ready' : 'none',
          from: list.installed ?? row.from,
          to: cand ? cand.version : '',
          listRegistry: list.registry ?? null,
          error: '',
        })
      }
    }

    const refresh = async () => {
      if (snapshot.busy) return
      patch({ stop: false })
      await load()
      await checkAll()
    }

    /* ------------------------------------------------------------------ run */

    /** 这一行最终问哪个源：行内覆盖 > 全局选择 > 返回新版本的源（官方 confirm 同口径）；null 交给宿主默认。 */
    function registryOf(row) {
      if (row.registryOverride !== null) return row.registryOverride
      if (snapshot.globalRegistry !== null) return snapshot.globalRegistry
      return row.listRegistry
    }

    /** 从备份本地拷回旧版并删备份。删失败不影响「已恢复」这个事实，残留会被列出供清理。 */
    async function restoreFromBackup(name) {
      await backupCall('restore', name)
      try { await backupCall('remove', name) } catch (_) {}
      await loadBackups()
    }

    async function runOne(row) {
      const requestId = crypto.randomUUID()
      const registry = registryOf(row)
      patch({ active: { name: row.name, requestId } })
      patchRow(row.name, { task: { phase: 'running', step: 'backup', error: '', restart: false } })

      // 1) 更新前先备份：失败才有得恢复。备份失败则中止本次更新（不让插件处于无保护状态）。
      try {
        await backupCall('create', row.name, {
          from: row.from, to: row.to, registry: registry ?? null, enabled: row.enabled,
        })
      } catch (err) {
        patch({ active: null })
        patchRow(row.name, { task: { phase: 'backup-failed', step: '', error: `备份失败，已跳过更新：${err.message}`, restart: false } })
        return
      }

      // 2) 更新
      patchRow(row.name, { task: { phase: 'running', step: 'checking', error: '', restart: false } })
      let answer
      try {
        answer = await ctx.remote.pluginManager.updateBundle(row.name, row.to, {
          ...(registry == null ? {} : { registry }),
          requestId,
        })
      } catch (err) {
        answer = { ok: false, error: { message: String(err?.message ?? err) } }
      }
      patch({ active: null })
      const okResult = answer.ok && !['failed', 'cancelled'].includes(answer.value?.result?.application)
      const diag = (answer.value?.result?.error?.diagnostic || answer.value?.result?.error?.code || answer.error?.message || '更新失败')

      if (okResult) {
        // 3a) 成功 → 行内当前版本同步为新版、清掉「→ 新版」箭头，再删备份
        try { await backupCall('remove', row.name) } catch (_) { await loadBackups() }
        const restart = answer.value.result.application === 'restart-required'
        patchRow(row.name, {
          from: row.to, to: '', check: 'none', selected: false,
          task: { phase: 'done', step: '', error: '', restart },
        })
        return
      }

      // 3b) 失败 → 自动从备份恢复（纯本地拷回，不查注册表，比宿主联网重装旧版快）
      patchRow(row.name, { task: { phase: 'running', step: 'restoring', error: '', restart: false } })
      try {
        await restoreFromBackup(row.name)
        patchRow(row.name, { task: { phase: 'rolledback', step: '', error: `${diag} · 已从备份恢复 ${row.from}`, restart: false } })
      } catch (err) {
        // 恢复也失败：保留备份，交给用户手动重试
        await loadBackups()
        patchRow(row.name, { task: { phase: 'restore-failed', step: '', error: `${diag} · 备份恢复失败：${err.message}`, restart: false } })
      }
    }

    async function runQueue() {
      if (snapshot.busy) return
      const names = snapshot.rows.filter((r) => r.selected && r.check === 'ready' && r.to).map((r) => r.name)
      if (!names.length) return
      patch({ busy: true, stop: false, summary: null })
      for (const name of names) {
        if (snapshot.stop) break
        const row = getRow(name)
        if (row) await runOne(row)
      }
      const done = names.filter((n) => getRow(n)?.task?.phase === 'done').length
      const bad = names.filter((n) => {
        const t = getRow(n)?.task
        return t && t.phase !== 'done' && t.phase !== 'running'
      }).length
      patch({ busy: false, active: null, summary: { done, bad, stopped: snapshot.stop } })
    }

    /** 手动兜底：自动恢复失败后，用户点「重装旧版」先试备份，再退化到联网重装。 */
    async function restoreOld(row) {
      if (snapshot.busy) return
      const requestId = crypto.randomUUID()
      patch({ busy: true, stop: false, active: { name: row.name, requestId } })
      patchRow(row.name, { task: { phase: 'running', step: 'restoring', error: '', restart: false } })
      try {
        await restoreFromBackup(row.name)
        patchRow(row.name, { task: { phase: 'rolledback', step: '', error: `已从备份恢复 ${row.from || '旧版'}`, restart: false } })
        patch({ busy: false, active: null })
        return
      } catch (_) {}
      // 备份也没了（例如被手动清理）→ 联网重装旧版
      const registry = registryOf(row)
      let answer
      try {
        answer = await ctx.remote.pluginManager.installBundle(`${row.name}@${row.from}`, {
          enabled: row.enabled, saveExact: true,
          ...(registry == null ? {} : { registry }), requestId,
        })
      } catch (err) {
        answer = { ok: false, error: { message: String(err?.message ?? err) } }
      }
      patch({ busy: false, active: null })
      const app = answer.ok ? answer.value?.application : null
      if (app === 'failed' || app === 'cancelled' || !answer.ok) {
        patchRow(row.name, { task: { phase: 'restore-failed', step: '', error: (answer.error?.message || answer.value?.error?.diagnostic || '重装旧版失败'), restart: false } })
      } else {
        patchRow(row.name, { task: { phase: 'rolledback', step: '', error: `已重装 ${row.from}`, restart: app === 'restart-required' } })
      }
    }

    function stop() {
      patch({ stop: true })
      const active = snapshot.active
      if (active?.requestId) ctx.remote.pluginManager.cancelInstall(active.requestId)
    }

    /* ------------------------------------------------------------------ view */

    function StatusCell(row) {
      const t = row.task
      if (t && t.phase === 'running') {
        return h('span', { className: 'dbu-tag busy' },
          h('span', { className: 'dbu-dot' }), `更新中 · ${STEP_TEXT[t.step] || t.step || '…'}`)
      }
      if (t && t.phase !== 'running') {
        const tone = { done: 'ok', rolledback: 'warn', 'restore-failed': 'bad', 'backup-failed': 'bad' }[t.phase] || 'muted'
        const label = { done: '已更新', rolledback: '已回滚', 'restore-failed': '回滚失败', 'backup-failed': '备份失败·未更新' }[t.phase]
        return h('span', { className: `dbu-tag ${tone}`, title: t.error || '' },
          h('span', { className: 'dbu-dot' }), label, t.restart ? ' · 待重启' : '')
      }
      if (row.check === 'checking') return h('span', { className: 'dbu-tag busy' }, h('span', { className: 'dbu-dot' }), '查版本中')
      if (row.check === 'ready') return h('span', { className: 'dbu-tag info' }, h('span', { className: 'dbu-dot' }), '可更新')
      if (row.check === 'none') return h('span', { className: 'dbu-tag ok' }, h('span', { className: 'dbu-dot' }), '已是最新')
      if (row.check === 'refused') return h('span', { className: 'dbu-tag bad', title: row.error || '' }, h('span', { className: 'dbu-dot' }), '检查失败')
      return h('span', { className: 'dbu-tag muted' }, h('span', { className: 'dbu-dot' }), '待检查')
    }

    /** 自绘下拉：原生 select 的展开态由系统渲染，CSS 无法美化，故改为 button + 浮层。 */
    function RegistryMenu(props) {
      const { value, options, onChange, disabled, title, width } = props
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => {
        if (!open) return
        const onDown = (e) => { if (!e.target.closest?.('.dbu-dd')) setOpen(false) }
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])
      const cur = value ?? ''
      return h('div', { className: 'dbu-dd', style: { maxWidth: width || 210 } },
        h('button', {
          type: 'button', className: 'dbu-select dbu-dd-trigger', disabled, title,
          onClick: () => setOpen((o) => !o),
        }, cur || DEFAULT_REGISTRY_LABEL),
        open
          ? h('div', { className: 'dbu-menu' }, options.map((r, i) => {
              const rv = r ?? ''
              return h('button', {
                key: i, type: 'button', className: `dbu-item${rv === cur ? ' on' : ''}`,
                onClick: () => { onChange(r); setOpen(false) },
              },
                h('span', { className: 'dbu-item-main' }, rv || DEFAULT_REGISTRY_LABEL),
                h('span', { className: 'dbu-item-hint' }, rv ? '自定义源' : '跟随 pnpm'),
                rv === cur ? h('span', { className: 'dbu-item-tick' }, '✓') : null)
            }))
          : null,
      )
    }

    function RegistrySelect(row) {
      return h(RegistryMenu, {
        value: registryOf(row) ?? '',
        options: snapshot.registries,
        disabled: snapshot.busy,
        title: '该插件更新时优先询问的注册表源',
        onChange: (r) => patchRow(row.name, { registryOverride: r }),
      })
    }

    function Tab() {
      const s = React.useSyncExternalStore(subscribe, getSnapshot)
      const ready = s.rows.filter((r) => r.check === 'ready')
      const selected = ready.filter((r) => r.selected)
      const running = s.rows.find((r) => r.task?.phase === 'running')
      return h('div', { className: 'dbu-wrap' },
        h('div', { className: 'dbu-bar' },
          h('div', { className: 'dbu-group' },
            h('button', { type: 'button', className: 'dbu-btn icon', disabled: s.busy, onClick: refresh },
              h('span', { className: 'dbu-ico' }, '⟳'), '刷新并检查'),
            h('label', { className: `dbu-chip${ready.length && selected.length === ready.length ? ' on' : ''}` },
              h('input', {
                type: 'checkbox', className: 'dbu-check', disabled: s.busy || !ready.length,
                checked: ready.length > 0 && selected.length === ready.length,
                onChange: (e) => patch({ rows: s.rows.map((r) => (r.check === 'ready' ? { ...r, selected: e.target.checked } : r)) }),
              }), `全选（${ready.length}）`),
          ),
          h('span', { className: 'dbu-sep' }),
          h('label', { className: 'dbu-field' }, '默认源',
            h(RegistryMenu, {
              value: s.globalRegistry ?? '',
              options: s.registries,
              disabled: s.busy,
              title: '所有插件默认使用的更新源（行内可单独覆盖）',
              onChange: (r) => patch({ globalRegistry: r, rows: s.rows.map((x) => ({ ...x, registryOverride: null })) }),
            })),
          h('span', { className: 'dbu-spacer' }),
          s.busy ? h('button', { type: 'button', className: 'dbu-btn', onClick: stop }, '停止') : null,
          h('button', {
            type: 'button', className: 'dbu-btn primary',
            disabled: s.busy || !selected.length, onClick: runQueue,
          }, s.busy ? '更新中…' : `更新所选（${selected.length}）`),
        ),
        s.busy ? h('div', { className: 'dbu-progress' }) : null,
        s.busy && running
          ? h('div', { className: 'dbu-note' }, `正在更新 ${running.title || running.name} · ${STEP_TEXT[running.task.step] || '…'}`)
          : null,
        s.error ? h('div', { className: 'dbu-note err' }, s.error) : null,
        s.leftovers.length
          ? h('div', { className: 'dbu-note' },
              `发现 ${s.leftovers.length} 个残留备份（上次中断留下）：${s.leftovers.map((b) => `${b.name}@${b.from}`).join('、')} `,
              h('button', { type: 'button', className: 'dbu-btn small', disabled: s.busy, onClick: clearLeftovers }, '清理'))
          : null,
        s.summary
          ? h('div', { className: 'dbu-note' },
              `${s.summary.stopped ? '队列已停止。' : ''}本轮完成 ${s.summary.done} 个，失败/回滚 ${s.summary.bad} 个。`
              + (s.rows.some((r) => r.task?.restart) ? ' 部分更新需重启后生效。' : ''))
          : null,
        s.phase === 'loading' && !s.rows.length ? h('div', { className: 'dbu-empty' }, '读取插件列表…') : null,
        s.phase === 'ready' && !s.rows.length
          ? h('div', { className: 'dbu-empty' },
              h('strong', {}, '没有需要更新的插件'),
              h('span', {}, '本地 link 来源的插件不参与注册表更新'))
          : null,
        h('div', { className: 'dbu-list' }, s.rows.map((row) => {
          const canRestore = row.task?.phase === 'restore-failed' && row.from
          return h('div', { key: row.name, className: `dbu-row${row.selected ? ' on' : ''}` },
            h('input', {
              type: 'checkbox', className: 'dbu-check', disabled: s.busy || row.check !== 'ready',
              checked: row.selected,
              onChange: (e) => patchRow(row.name, { selected: e.target.checked }),
            }),
            h('div', { className: 'dbu-main' },
              h('div', { className: 'dbu-title' }, row.title),
              h('div', { className: 'dbu-meta' },
                h('span', { className: 'dbu-pkg' }, row.name),
                h('span', { className: 'dbu-ver' }, row.from || '?'),
                row.to ? h('span', { className: 'dbu-arrow' }, '→') : null,
                row.to ? h('span', { className: 'dbu-ver new' }, row.to) : null),
              row.task?.error ? h('div', { className: 'dbu-err' }, row.task.error) : null),
            RegistrySelect(row),
            StatusCell(row),
            canRestore
              ? h('button', {
                  type: 'button', className: 'dbu-btn small', disabled: s.busy,
                  onClick: () => restoreOld(row), title: `重新安装 ${row.from}`,
                }, '重装旧版')
              : null,
          )
        })),
      )
    }

    return {
      name: 'dsh-batch-update',
      inject: ['slots', 'remote', 'remote.pluginManager'],
      apply(hostCtx) {
        // 整个 apply 包进 try/catch：任一服务缺失/出错都不拖垮 web boot。
        try {
          ctx = hostCtx
          ensureCss()
          const slots = hostCtx.get('slots')
          if (!slots) return

          // remote 事件订阅，失败静默（不影响 tab 渲染）
          try {
            hostCtx.effect(() => {
              let off = null
              try {
                off = hostCtx.remote?.$on?.('plugin-manager/update-state', (p) => {
                  const active = snapshot.active
                  if (!active || p.requestId !== active.requestId) return
                  patchRow(active.name, { task: { ...getRow(active.name)?.task, phase: 'running', step: p.step } })
                })
              } catch (_) {}
              return () => { try { off && (typeof off === 'function' ? off() : off.dispose?.()) } catch (_) {} }
            }, 'dsh-batch-update: update-state')
          } catch (_) {}

          hostCtx.effect(() => {
            let handle = null
            try {
              handle = slots.inject('plugins.tab', () =>
                slots.register({ name: 'plugins.tab', id: 'batch-update', order: 60, label: '更新' }, () => h(Tab)))
            } catch (_) { return }
            readRegistries()
            loadBackups()
            refresh()
            return () => { try { handle?.dispose?.() ?? handle?.() } catch (_) {} }
          }, 'dsh-batch-update: tab')
        } catch (_) {}
      },
    }
  },
})
