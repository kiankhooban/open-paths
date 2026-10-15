# open-paths

**Click a file path in Claude Code, and the file opens in its app.**

Claude writes `~/Desktop/Report.docx`. You Cmd+click it. Word opens. A PDF opens in Preview, a spreadsheet in Excel, `app.py:42` in VS Code at line 42.

Out of the box, Claude Code's fullscreen renderer answers a click on a file path by showing the file in your file manager, not opening it ([fullscreen docs](https://code.claude.com/docs/en/fullscreen#use-the-mouse); see also [#71658](https://github.com/anthropics/claude-code/issues/71658)), and paths in Claude's replies are often not links at all. open-paths turns every path Claude writes into a link that opens the file itself.

![open-paths demo](docs/demo.gif)

## Install

At the prompt of a Claude Code session:

```text
/plugin install open-paths --marketplace kiankhooban/open-paths
```

Answer `y` to add the marketplace, pick a scope, and it is active at once. From a shell:

```bash
claude plugin install open-paths --marketplace kiankhooban/open-paths
```

## What opens where

| You click | It opens in |
|---|---|
| `.docx` `.pdf` `.xlsx` `.pptx` `.png` `.csv` `.html` and every other document | the file type's default app |
| `.py` `.java` `.ts` `.c` `.go` `.rs` `.json` `.md` and 100+ other code and text types | your editor (VS Code by default), at the line when one is written: `app.py:42`, `main.c:10:5` |
| a folder | Finder, Explorer or your file manager |
| `.sh` `.command` `.ps1` and other scripts | your editor, never their default app: opened by a terminal, a script runs |
| `.app` `.pkg` `.dmg` `.exe`, and any type not on the lists above | revealed in the file manager, never launched |

## What it links

- Absolute paths, `~/` paths and paths relative to Claude's working directory.
- Paths in backticks, including ones with spaces: `` `~/My Drive/Notes Q1.docx` ``.
- `file:line` and `file:line:col`.
- Paths inside code blocks get a `↳ open` row under the block, so the code stays copyable.
- Bare file names Claude mentions after its tools touched them: Claude writes `~/output/Report.docx`, later says "see Report.docx", and that name opens the right file.
- `Write` tool rows get an `⎿ open` line under them (`/open-paths tools all` adds Read and Edit).

Only paths that exist become links, checked against the file system with a short cache, so a made-up or stale path stays plain text.

## Settings

Run `/open-paths` to see the current settings.

```text
/open-paths editor cursor              vscode, cursor, zed, sublime, idea, default, or any app name
/open-paths set pdf Skim               send a file type to an app
/open-paths set txt editor             ... or to the editor, the default app, or a reveal
/open-paths unset pdf                  back to the built-in rule
/open-paths folders editor             folders open in the editor instead of the file manager
/open-paths tools all|write|off        open lines under tool rows
/open-paths toast off                  no "Opening Report.docx" toast
/open-paths mode inline|auto|below|off how links are drawn (below)
```

A script or launcher type cannot be sent to its default app or another app, only to the editor or a reveal.

## Works with other mods

Mods that redraw Claude's replies (themes, markdown viewers, math renderers) and open-paths both want to draw the same reply. The default `inline` mode draws replies that contain paths itself, so the links sit in the text. `auto` keeps another mod's drawing whole and adds a dim `↳ open` row of links under it; `below` always uses the row.

## Platforms

Supports macOS (`open`), Linux (`xdg-open`), Windows (`start`, Explorer) and WSL (`wslview`, or Explorer with the path translated by `wslpath`).

In Claude Code's fullscreen renderer the mod answers the click itself. In the classic renderer the terminal follows the link: documents go as `file://` links, code goes through your editor's URL scheme (`vscode://file/...:42`), and launchers and scripts get no terminal link at all.

## Safety

Claude's replies can be steered by text it reads (a web page, a file), so open-paths treats every path in a reply as untrusted:

- **Allow-list, not deny-list.** Only known document and media types go to their default app. Code goes to your editor. Everything else is revealed in the file manager, so a type nobody thought of cannot launch.
- **Real paths.** Every symlink is followed before deciding: a link named `report.pdf` that leads to an app is revealed, not opened.
- **No shell.** Commands run by argument vector. On Windows, documents open through Explorer; a file name holding characters `cmd.exe` would act on (`& | ^ % !`) is refused, not passed on.
- **No network paths.** Paths that land on a network share are never linked: opening one can send credentials to its host.
- **Nothing on an unknown system.** If the platform cannot be identified, nothing opens.

Two limits worth knowing: `.html` and `.svg` open in your browser, which runs their scripts exactly as a double-click would; and a file swapped for another in the instant between the click and the open is opened as whatever it now is, as with any opener.

## How it works

A `ui.render` hook on assistant messages finds the paths, resolves them against the session's working directory and home, checks they exist, and draws the reply as markdown whose links the mod answers (`onLinkPress`). A click runs one command, by argument vector with no shell: `open`, `xdg-open`, `cmd /c start`, or your editor's command line. Nothing leaves your machine, and the stored conversation is never changed: only its drawing carries the links.

## Development

```bash
git clone https://github.com/kiankhooban/open-paths
claude --plugin-dir ./open-paths      # a session with the mod loaded, reloading as you edit
claude plugin validate ./open-paths
claude plugin test ./open-paths       # the tests, run by Claude Code's own engine
```

## License

MIT
