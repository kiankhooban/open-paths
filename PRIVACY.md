# Privacy

open-paths collects no data and sends nothing anywhere. It makes no network calls.

Everything it handles stays on your machine:

- It checks whether file paths in Claude's replies exist (file metadata only, never file contents).
- It keeps your `/open-paths` settings, and the paths of files Claude's tools read or wrote, in the mod's local store so bare file names can be found again. Nothing in that store leaves your machine.
- When you click a path, it starts one local program (your default app, your editor, or the file manager) with that file's path.

There is no telemetry, no account and no third party. The full list of what the mod reads, runs and stores is in the [README](README.md#what-it-reads-runs-and-sends).

Questions: [open an issue](https://github.com/kiankhooban/open-paths/issues).
