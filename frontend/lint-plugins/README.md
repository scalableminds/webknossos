# Custom GritQL lint plugins

[Biome](https://biomejs.dev) lint rules written in [GritQL](https://biomejs.dev/linter/plugins/),
used to catch antd anti-patterns that Biome's built-in rules cannot express.

| Plugin | Severity | Catches |
| --- | --- | --- |
| `noRawHeading.grit` | error | Raw `<h1>`–`<h5>` tags; use `<Typography.Title level={n}>` |
| `noFlexDiv.grit` | warn | `<div style={{ display: "flex" }}>`; prefer antd `<Flex>` |

## These only run in CI

Plugins are expensive (~6x slower than a plain lint), so they're declared only in
`biome.ci.jsonc` (which extends the root `biome.jsonc`), run via `yarn check-frontend-ci`.
Prefer a built-in Biome rule over a plugin when one can express the check — plugins are
a last resort.

## Gotcha: plugins can fail silently

A plugin that compiles is not necessarily a plugin that works — a broken plugin
(e.g. `language js` followed by a bare `or {`, or a capturing group in a `r"..."` regex)
can exit 0 and print nothing, same as a healthy rule with no matches. **Never trust exit
status** — lint a file that violates the rule and confirm the diagnostic actually appears.

