# Custom GritQL lint plugins

[Biome](https://biomejs.dev) lint rules written in [GritQL](https://biomejs.dev/linter/plugins/),
used to catch antd anti-patterns that Biome's built-in rules cannot express.

| Plugin | Severity | Catches |
| --- | --- | --- |
| `noRawHeading.grit` | error | Raw `<h1>`–`<h5>` tags; use `<Typography.Title level={n}>` |
| `noFlexDiv.grit` | warn | `<div style={{ display: "flex" }}>`; prefer antd `<Flex>` |

## These only run in CI

The plugins are **not** declared in the root `biome.jsonc`. They are declared in
`.biome-ci/biome.jsonc`, which extends the root config, and CI runs them via:

```bash
yarn check-frontend-lint-plugins
```

Why: plugins are expensive. Measured on `frontend/javascripts` (~880 files):

| Config | Lint time |
| --- | --- |
| No plugins | ~184 ms |
| 1 plugin (5 patterns) | ~853 ms |
| 2 plugins | ~1112 ms |

The cost scales with the number of GritQL **patterns**, not the number of plugins —
roughly ~300 ms to enable plugins at all, then ~85 ms per additional pattern. Keeping
them out of `yarn check-frontend` keeps the local/pre-push loop fast.

## Prefer built-in rules when they can express the check

A plugin is a last resort. Biome's own rules are faster, better tested, and maintained.
For example, banning `antd/lib` imports was first attempted as a plugin, but
`import $spec from $src` only matches **single-specifier** imports, so
`import type { A, B } from "antd/lib/form"` slipped through. `noRestrictedImports` with
a `patterns` glob catches every import shape, including dynamic `import()`.

## Gotcha: plugins can fail silently

**A plugin that compiles is not necessarily a plugin that works.** Verified on Biome 2.3.13:

| Plugin state | exit | output |
| --- | --- | --- |
| Most malformed files (garbage, unclosed backtick, empty, unknown function) | 1 | `Failed to compile the Grit plugin` |
| `language js` followed by a bare `or {` | **0** | **nothing** |
| Runtime error (e.g. a **capturing** group in a `r"..."` regex) | 0 | `errored: ...` as a non-failing info |
| Compiles but matches nothing | 0 | nothing |
| Healthy `warn`-severity plugin | 0 | warnings |

Consequences:

- **Never use exit status to judge whether a rule is working** — a healthy `warn` rule
  and a dead rule both exit 0. Check the *diagnostics*.
- Use non-capturing groups (`(?:...)`) in GritQL regexes; a capturing group raises
  `regex pattern matched 1 variables, but expected 0` and the rule stops matching.
- To confirm a rule still fires, lint a file that violates it and assert the expected
  diagnostic appears. `noRawHeading` currently has zero violations in the codebase, so
  it produces no output whether it is healthy or broken.

## Duplicate `plugins` keys

`plugins` is a single top-level key. If a merge leaves two of them in one config, the
last silently wins and the other rules are dropped with no warning. This has already
happened once during a `master` merge.
