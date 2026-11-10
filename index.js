/**
 * 插件批量更新 —— 宿主半边：备份管理。
 *
 * 浏览器半边没有文件系统，备份必须落在这里。提供一条同源路由：
 *
 *   POST /batch-update/backup  { action, name, ... }
 *     create  -> 更新前把 node_modules/<name> 整个复制到 $DSH_HOME 下
 *     restore -> 失败时把备份原样拷回（纯本地、不查注册表，所以快）
 *     remove  -> 成功或恢复后删除备份
 *   GET  /batch-update/backup -> 列出残留备份（崩溃/中断留下的）
 *
 * 备份放 $DSH_HOME/dsh-batch-update/backups/，不放包目录：pnpm 更新插件时
 * 整目录可能被替换，放里面会被一起清掉。
 */
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-batch-update'
export const inject = []

const ROUTE = '/batch-update/backup'

const home = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const profileDir = () => process.env.DSH_PROFILE_DIR || join(home(), 'profiles', process.env.DSH_PROFILE || 'desktop')
const root = () => join(home(), 'dsh-batch-update', 'backups')

/** 包名可能是 @scope/pkg：把路径分隔符等危险字符折成下划线。 */
const slug = (name) => String(name).replace(/[^a-zA-Z0-9._-]/g, '_')
const backupDir = (name) => join(root(), slug(name))

/** 收敛不可信包名，拒绝任何越出 node_modules 的路径。 */
function pkgDir(name) {
  if (typeof name !== 'string' || !name || name.includes('..') || name.startsWith('/') || /[\\:]/.test(name)) return null
  return join(profileDir(), 'node_modules', name)
}

async function metaOf(name) {
  try {
    return JSON.parse(await readFile(join(backupDir(name), 'backup.json'), 'utf8'))
  } catch { return null }
}

/** 复制真实文件而非符号链接：更新时 .pnpm 可能被裁剪，指向它的链接会断。 */
async function create(name, info) {
  const src = pkgDir(name)
  if (!src) throw new Error('非法包名')
  const dst = backupDir(name)
  await rm(dst, { recursive: true, force: true })
  await mkdir(dst, { recursive: true })
  await cp(src, join(dst, 'package'), { recursive: true, dereference: true, force: true })
  const meta = {
    name,
    from: String(info?.from ?? ''),
    to: String(info?.to ?? ''),
    registry: info?.registry ?? null,
    enabled: info?.enabled !== false,
    createdAt: new Date().toISOString(),
  }
  // 先写临时文件再改名，进程中途被杀也不会留下半个 JSON。
  const metaPath = join(dst, 'backup.json')
  const tmp = `${metaPath}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8')
  await rename(tmp, metaPath)
  return meta
}

async function restore(name) {
  const meta = await metaOf(name)
  if (!meta) throw new Error('没有找到该插件的备份')
  const src = join(backupDir(name), 'package')
  const dst = pkgDir(name)
  if (!dst) throw new Error('非法包名')
  await rm(dst, { recursive: true, force: true })
  await mkdir(dirname(dst), { recursive: true })
  await cp(src, dst, { recursive: true, dereference: true, force: true })
  return meta
}

async function remove(name) {
  await rm(backupDir(name), { recursive: true, force: true })
}

async function list() {
  let names = []
  try { names = await readdir(root()) } catch { return [] }
  const out = []
  for (const dir of names) {
    try { out.push(JSON.parse(await readFile(join(root(), dir, 'backup.json'), 'utf8'))) } catch {}
  }
  return out
}

function isLocal(req) {
  const addr = req.socket && req.socket.remoteAddress
  return typeof addr === 'string' && /^(::1|127\.|::ffff:127\.)/.test(addr)
}

function sendJson(res, code, value) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function apply(ctx) {
  const mount = (hostCtx) => {
    const webServer = hostCtx
      && (hostCtx.webServer || (typeof hostCtx.get === 'function' ? hostCtx.get('webServer') : undefined))
    if (!webServer || typeof webServer.register !== 'function') return
    ctx.effect(() => {
      const off = webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: async (req, res) => {
          if (!isLocal(req)) return sendJson(res, 403, { ok: false, error: '只接受本机请求' })
          try {
            if (req.method === 'GET') return sendJson(res, 200, { ok: true, backups: await list() })
            if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: '只支持 GET / POST' })
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            const { action, name } = body || {}
            if (typeof name !== 'string' || !name) return sendJson(res, 400, { ok: false, error: '缺少 name' })
            if (action === 'create') return sendJson(res, 200, { ok: true, backup: await create(name, body) })
            if (action === 'restore') return sendJson(res, 200, { ok: true, backup: await restore(name) })
            if (action === 'remove') { await remove(name); return sendJson(res, 200, { ok: true }) }
            return sendJson(res, 400, { ok: false, error: '未知 action' })
          } catch (error) {
            return sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      })
      return off
    }, 'dsh-batch-update: backup route')
  }
  // apply 期 webServer 往往还没就绪，走 inject 回调等它到位。
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mount)
  else mount(ctx)
}
