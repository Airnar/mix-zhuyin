# PIME fork for MixZhuyin

This directory is a trimmed copy of [PIME](https://github.com/EasyIME/PIME)
that MixZhuyin builds and ships as its own text service, so users do not
need to install PIME. It is renamed so it can be installed next to PIME.

## Sources

| Directory | Upstream | Version |
| --- | --- | --- |
| `PIMETextService/`, `PIMELauncher/`, `node/` (without `node.exe`, `node_modules/` and `input_methods/`), `json/`, `CMakeLists.txt`, license files | EasyIME/PIME | tag `v2.0.0-beta4` (`6b31e19b28d433a7c2fc42b7eff991fd62518db5`) |
| `libIME2/` (`src/` only) | EasyIME/libIME2 | `78e61045956960a511f85eb823e0fd65fa8c94b9` (the submodule commit of PIME v2.0.0-beta4) |

Left out: the Python and Go backends, the other input methods, tests,
`node.exe` and `node_modules/` (the build downloads Node.js and runs `npm ci`), and PIME's installer.

## Licenses

PIME's text service, launcher and libIME2 are LGPL 2.0 (`LGPL-2.0.txt`,
`LICENSE.txt`); nlohmann/json is MIT (`json/LICENSE.MIT`); the Node.js
backend (`node/`) is MIT. Changes made here are listed below and published
with the rest of this repository.

## Changes from upstream

The first commit touching this directory is the unmodified import; later
commits carry the changes. In short:

- **Renamed so it coexists with PIME**: new text service CLSID
  `{A64DF4E9-E913-47D2-A89A-CF3134688E0D}` and display attribute GUID
  (`PIMEImeModule.cpp`), DLL output name `MixZhuyinTextService` (CMake,
  `.def` files, version resource), launcher binary `MixZhuyinLauncher`,
  named pipe `\\.\pipe\<user>\MixZhuyin\Launcher`, per-session event and
  mutex names, window class names.
- **Install folder**: the text service finds its folder from its own DLL
  path instead of `Program Files (x86)\PIME`.
- **Build**: `CMakeLists.txt` reads the version from MixZhuyin's
  `output/pime/ime.json` and builds only libIME2 and the text service; the
  launcher is built with cargo; upstream tests and googletest are left out.
- **Look**: `libIME2/src/ImeTheme.*` (new) and changes to `CandidateWindow`,
  `MessageWindow`, `ImeWindow` and `Window` draw the candidate and message
  windows in Windows light/dark colors with rounded corners; the text service
  creates its font with ClearType and Microsoft JhengHei UI. The candidate
  and message windows sit a few pixels below the text (or above it near the
  bottom of the screen) instead of overlapping it (`ImeWindow::moveNearText`).
- **Target clause**: a second display attribute (thick solid underline,
  `TF_ATTR_TARGET_CONVERTED`); `TextService::setCompositionTarget` applies it
  to a range, and the client reads the range from a new `compositionHighlight`
  field (`[start, end)` in code points, like `compositionCursor`).
- **Password fields**: `TextService::shouldPassKeysThrough` also passes keys
  through when the input scope at the cursor is a password or PIN
  (`isPasswordField`, checked only while not composing).
- **Fix**: `ImeModule::unregisterServer` registered the systray category
  instead of unregistering it, leaving the TIP key behind after uninstall.
- **Config tool**: `onConfigure` starts the config tool hidden (it is
  `node.exe config_tool.js`, which opens the browser itself).
