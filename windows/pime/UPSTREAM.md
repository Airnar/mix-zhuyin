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

See the git history of this directory; the first commit is the unmodified
import.
