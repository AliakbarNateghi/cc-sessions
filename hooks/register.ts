import type { Register } from 'claude-code'

const DAY = 86_400_000

const fmtBytes = (n: number) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${i === 0 ? n : n.toFixed(1)} ${units[i]}`
}
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sessions',
      description: 'Report session files per project. "archive <days>" moves older ones to a gzipped archive.',
      argumentHint: '[archive <days>]',
    })
    return next(e)
  })

  on('command.run', { command: 'sessions' }, async ($, e) => {
    const args = e.args.trim().split(/\s+/).filter(Boolean)
    const isArchive = args[0] === 'archive'
    const days = Number(args[1])
    if (args.length > 0 && !(isArchive && args.length === 2 && Number.isFinite(days) && days >= 0)) {
      return { text: 'Usage: /sessions  or  /sessions archive <days>' }
    }

    let dir = String(options.projectsDir || '~/.claude/projects').replace(/\/+$/, '')
    if (dir === '~' || dir.startsWith('~/')) {
      const home = await $.env.get('HOME')
      if (!home) return { text: 'sessions: HOME is not set, cannot resolve ~.' }
      dir = home + dir.slice(1)
    }
    if (!(await $.fs.exists(dir))) return { text: `sessions: ${dir} does not exist.` }

    const projects = await Promise.all(
      (await $.fs.list(dir)).filter(d => d.kind === 'dir').map(async d => ({
        name: d.name,
        files: (await $.fs.list(`${dir}/${d.name}`)).filter(f => f.kind === 'file' && f.name.endsWith('.jsonl')),
      })),
    )

    if (isArchive) {
      const current = `${await $.session.id()}.jsonl`
      const cutoff = (await $.clock.now()) - days * DAY
      const archiveRoot = `${dir.replace(/\/[^/]*$/, '') || '/'}/session-archive`
      const run = (argv: string[]) =>
        $.process.run(argv, { timeoutMs: 120_000 }).catch(() => ({ exitCode: 1, stdout: '', stderr: 'could not start' }))
      let count = 0, freed = 0
      const errors: string[] = []
      for (const p of projects) {
        // Never touch the running session's own transcript.
        const old = p.files.filter(f => f.mtimeMs < cutoff && f.name !== current)
        if (old.length === 0) continue
        const dest = `${archiveRoot}/${p.name}`
        if ((await run(['mkdir', '-p', dest])).exitCode !== 0) { errors.push(`mkdir failed: ${dest}`); continue }
        for (const f of old) {
          const src = `${dir}/${p.name}/${f.name}`
          // -n: never overwrite an archived file; if the target exists the source stays put.
          await run(['mv', '-n', src, `${dest}/`])
          if (await $.fs.exists(src)) { errors.push(`not moved: ${src}`); continue }
          count++
          freed += f.size
          const gz = await run(['gzip', `${dest}/${f.name}`])
          if (gz.exitCode !== 0) errors.push(`moved but not gzipped: ${dest}/${f.name}: ${gz.stderr.trim()}`)
        }
      }
      const text = `Archived ${count} session file(s) older than ${days} day(s) to ${archiveRoot}, freed ${fmtBytes(freed)} (${freed} bytes) from ${dir}.`
      return { text: errors.length ? `${text}\n${errors.join('\n')}` : text }
    }

    const rows = projects.map(p => {
      const times = p.files.map(f => f.mtimeMs)
      return {
        name: p.name,
        count: p.files.length,
        size: p.files.reduce((s, f) => s + f.size, 0),
        oldest: times.length ? fmtDate(Math.min(...times)) : '-',
        newest: times.length ? fmtDate(Math.max(...times)) : '-',
      }
    }).sort((a, b) => b.size - a.size)

    const nw = Math.max(7, ...rows.map(r => r.name.length))
    const line = (n: string, c: string, s: string, o: string, w: string) =>
      `${n.padEnd(nw)}  ${c.padStart(5)}  ${s.padStart(9)}  ${o.padEnd(10)}  ${w}`
    const total = rows.reduce((t, r) => ({ count: t.count + r.count, size: t.size + r.size }), { count: 0, size: 0 })
    const out = [
      `Sessions in ${dir}:`,
      line('project', 'files', 'size', 'oldest', 'newest'),
      ...rows.map(r => line(r.name, String(r.count), fmtBytes(r.size), r.oldest, r.newest)),
      line('TOTAL', String(total.count), fmtBytes(total.size), '', ''),
    ]
    const user = await $.settings.read({ source: 'user' }).catch(() => ({} as Record<string, unknown>))
    if ((user as Record<string, unknown>).cleanupPeriodDays === undefined) {
      out.push('', 'Hint: Claude Code deletes sessions after 30 days; add "cleanupPeriodDays": 99999 to keep them.')
    }
    return { text: out.join('\n') }
  })
}
