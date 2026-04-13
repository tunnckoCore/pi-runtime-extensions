# pi-runtime-extensions

Load/unload Pi extensions dynamically during a running session.

`pi-runtime-extensions` adds three commands:

- `/ext:load <path>`
- `/ext:list` - toggle on/off runtime extensions
- `/ext:unload` - remove runtime extensions

The goal is simple: let you bring an extension into the current Pi runtime without restarting Pi with `-e ...`, while keeping the load temporary and easy to undo.

## When to use this

Use `pi-runtime-extensions` when you want to:

- quickly try a local extension during an active Pi session
- toggle debugging or utility extensions on and off
- load project-local tools without restarting Pi manually
- explore extension workflows interactively

If you want long-term, always-on project behavior, normal Pi extension discovery is still the better fit.

## What it does

When you load an extension, this package:

1. creates a small runtime wrapper under `.pi/runtime-extensions/`
2. adds only its managed runtime paths to `.pi/settings.json#extensions`
3. triggers a Pi reload
4. removes those managed runtime paths again when the session shuts down

This means:

- extensions can be loaded dynamically from a command
- relative imports in the original extension still work
- unloaded extensions stay visible in the toggle list as `[off]`
- unrelated project extensions are left alone
- existing `.pi/extensions/` contents are preserved

## Why runtime, not session?

These extensions are **runtime-loaded**, not persisted as a durable session binding model.

They live only for the active Pi run and are cleaned up when the session exits. So “runtime extensions” is the more accurate mental model.

## Commands

### `/ext:load <path>`
Load an extension file into the current Pi runtime.

Examples:

```text
/ext:load ./pi-extensions/pi-pi.ts
/ext:load ./pi-extensions/damage-control.ts
/ext:load ~/code/my-ext/index.ts
```

If the target extension imports sibling files, that still works. The runtime wrapper re-exports the original file instead of copying it, so relative imports resolve from the original source location.

### `/ext:list`
Open a toggle list of tracked runtime extensions.

Each entry shows as:

- `[on] ...` for enabled
- `[off] ...` for disabled

Press Enter on an item to toggle it on or off.

The list also includes:

- `+ Load extension...`

which prompts for a new extension path.

### `/ext:unload`
Remove a tracked runtime extension completely.

Unlike `/ext:list`, this does not just switch an entry to `[off]`. It removes the selected entry from:

- `.pi/runtime-extensions-manifest.json`
- `.pi/settings.json#extensions`
- the managed runtime wrapper directory

## Runtime layout

Managed files live under `.pi/`:

```text
.pi/
  runtime-extensions/
    damage-control-a1b2c3d4/
      index.ts
    pi-pi-e5f6a7b8/
      index.ts
  runtime-extensions-manifest.json
  settings.json
```

### Important behavior

- This package does **not** wipe `.pi/extensions/`
- It does **not** remove unrelated `.pi/settings.json#extensions` entries
- It only manages the runtime extension paths it created itself

## How it works

The package does **not** copy the original extension source into `.pi/extensions/`.

Instead, it generates a wrapper like this:

```ts
export { default } from "/absolute/path/to/original-extension.ts";
export * from "/absolute/path/to/original-extension.ts";
```

That approach matters because many Pi extensions use relative imports such as:

```ts
import { something } from "./helper.ts";
```

If the source file were copied into another directory, those imports would break. Re-exporting the original file avoids that.

## Install / use

### Local project usage

From this repository:

```bash
pi -e .
```

Because the package declares its Pi extension entry in `package.json`, Pi can load it directly from the project root.

### As a package

If you publish/install it as a Pi package, load it the same way you load other Pi extensions/packages.

## Development

```bash
bun run test

bun run cov

bun run typecheck
```

## Notes

- This package is intentionally conservative about cleanup.
- It treats managed runtime wrappers as ephemeral runtime state.
- If you want permanent project extensions, put them in `.pi/extensions/` yourself instead of using `/ext:load`.
