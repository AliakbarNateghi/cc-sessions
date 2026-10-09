import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = Date.UTC(2026, 9, 10)
const DAY = 86_400_000
type F = { size: number; mtimeMs: number }

// In-memory world beneath the plugin: /h/.claude/projects/{a,b}; mv/gzip recorded.
const world = (on: On, calls: string[][], settings: Record<string, unknown> = {}) => {
  const files: Record<string, F> = {
    '/h/.claude/projects/a/old.jsonl': { size: 1000, mtimeMs: NOW - 40 * DAY },
    '/h/.claude/projects/a/cur.jsonl': { size: 500, mtimeMs: NOW - 40 * DAY },
    '/h/.claude/projects/a/new.jsonl': { size: 200, mtimeMs: NOW - 1 * DAY },
    '/h/.claude/projects/a/note.txt': { size: 9999, mtimeMs: NOW - 90 * DAY },
    '/h/.claude/projects/b/x.jsonl': { size: 5000, mtimeMs: NOW - 5 * DAY },
  }
  const dirs = ['/h/.claude/projects', '/h/.claude/projects/a', '/h/.claude/projects/b']
  on('env.get', async () => ({ value: '/h' }))
  on('session.id', async () => ({ value: 'cur' }))
  on('clock.now', async () => ({ value: NOW }))
  on('settings.read', async () => ({ value: settings }))
  on('fs.exists', async ($, e) => ({ value: dirs.includes(e.path) || e.path in files }))
  on('fs.list', async ($, e) => {
    const kids = new Map<string, { kind: 'file' | 'dir'; size: number; mtimeMs: number }>()
    for (const d of dirs) if (d.startsWith(e.path + '/') && !d.slice(e.path.length + 1).includes('/'))
      kids.set(d.slice(e.path.length + 1), { kind: 'dir', size: 0, mtimeMs: 0 })
    for (const [p, f] of Object.entries(files)) if (p.startsWith(e.path + '/') && !p.slice(e.path.length + 1).includes('/'))
      kids.set(p.slice(e.path.length + 1), { kind: 'file', ...f })
    return { value: [...kids].map(([name, k]) => ({ name, isLink: false, ...k })) }
  })
  on('process.run', async ($, e) => {
    const a = [...e.argv]
    calls.push(a)
    if (a[0] === 'mv') delete files[a[2]!]
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const cmd = (args: string) =>
  ({ command: 'sessions', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } })

test('report sorts by size, totals, hints, and runs nothing', async ($: Engine, on: On) => {
  const calls: string[][] = []
  world(on, calls)
  const { text = '' } = await $.command.run(cmd(''))
  expect(text).toMatch(/^b\s+1\s+4\.9 KB\s+2026-10-05\s+2026-10-05$/m)
  expect(text).toMatch(/^a\s+3\s+1\.7 KB\s+2026-08-31\s+2026-10-09$/m)
  expect(text.indexOf('\nb ')).toBeLessThan(text.indexOf('\na '))
  expect(text).toMatch(/^TOTAL\s+4\s+6.5 KB/m)
  expect(text).toContain('"cleanupPeriodDays": 99999')
  expect(calls).toEqual([])
})

test('no hint when cleanupPeriodDays is set', async ($: Engine, on: On) => {
  world(on, [], { cleanupPeriodDays: 60 })
  const { text = '' } = await $.command.run(cmd(''))
  expect(text.includes('cleanupPeriodDays')).toBe(false)
})

test('archive moves and gzips only old files, never the current session', async ($: Engine, on: On) => {
  const calls: string[][] = []
  world(on, calls)
  const { text = '' } = await $.command.run(cmd('archive 30'))
  expect(calls).toEqual([
    ['mkdir', '-p', '/h/.claude/session-archive/a'],
    ['mv', '-n', '/h/.claude/projects/a/old.jsonl', '/h/.claude/session-archive/a/'],
    ['gzip', '/h/.claude/session-archive/a/old.jsonl'],
  ])
  expect(text).toContain('Archived 1 session file(s)')
  expect(text).toContain('(1000 bytes)')
  expect(calls.some(c => c[0] === 'rm')).toBe(false)
})

test('bad args print usage and do nothing', async ($: Engine, on: On) => {
  const calls: string[][] = []
  world(on, calls)
  for (const a of ['archive', 'archive x', 'delete 3']) {
    expect((await $.command.run(cmd(a))).text).toContain('Usage')
  }
  expect(calls).toEqual([])
})
