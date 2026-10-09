# sessions

A Claude Code mod that adds `/sessions`.

- `/sessions` lists each project folder in the Claude Code projects dir with its number of `*.jsonl` session files, their total size, and the oldest and newest modified dates (UTC). Biggest first, with a total. It only reports. If `cleanupPeriodDays` is not set in `~/.claude/settings.json`, it prints a hint, since Claude Code deletes sessions after 30 days by default.
- `/sessions archive <days>` moves session files older than `<days>` days to `<projectsDir>/../session-archive/<project>/` and gzips them (`mkdir -p`, `mv -n`, `gzip`). It reports the count and the bytes freed. It never archives the current session's file and never overwrites an archived file.

Nothing is ever deleted. Needs `mv` and `gzip`.

Option `projectsDir` (default `~/.claude/projects`): the projects folder. A leading `~` means your home dir.

## Install

```
/plugin install sessions --marketplace AliakbarNateghi/cc-sessions
```
