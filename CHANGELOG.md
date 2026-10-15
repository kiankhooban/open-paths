# Changelog

## 0.2.0

- Security: the system opener is only handed known document and media types (an allow-list); anything else is revealed, never launched.
- Security: links and clicks follow symlinks to the real file, so a link named like a document cannot open an app.
- Security: on Windows, documents open through Explorer with no shell, and names `cmd.exe` would act on are refused; network paths are never linked; nothing opens on an unidentified system.
- Paths draw as links in place by default; `auto` and `below` modes keep another mod's drawing and add a row of links under it.
- Paths inside code blocks get a `↳ open` row under the block.
- Bare file names resolve to files Claude's tools read or wrote, even outside the working directory.
- `Write` tool rows get an open line (`/open-paths tools all` for Read and Edit too).
- `/open-paths` settings: mode, editor (VS Code, Cursor, Zed, Sublime Text, IntelliJ IDEA, any app), per-type overrides, folders, tool rows, toast.
- A toast says what is opening and where.
- Linux, Windows and WSL openers.
- Classic renderer: links the terminal follows, code through the editor's URL scheme.
- Windows drive-letter paths.

## 0.1.0

- Paths in Claude's replies that exist become links; a click opens the file in its app: documents in their default app, code in VS Code at the line, folders in Finder, launchers revealed, scripts never run.
