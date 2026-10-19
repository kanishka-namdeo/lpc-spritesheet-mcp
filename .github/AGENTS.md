# .github/

## Purpose

The repository's automation and community surface: the single automated gate
(CI), the Dependabot config, and the issue/PR templates that shape every
incoming report. Templates exist because the asset-pack prerequisite is this
project's highest-volume support path.

## Ownership

- `workflows/ci.yml` — trigger, matrix, pinned asset-pack checkout, `npm test`, graceful-failure check.
- `dependabot.yml` — weekly version updates for `npm` (root lockfile) and
  `github-actions` (`actions/checkout@v7`, `actions/setup-node@v7`), plus
  `applies-to: security-updates` grouping per ecosystem.
- `ISSUE_TEMPLATE/config.yml` — blank issues disabled; the three contact links
  (asset-pack install, upstream pack, security policy).
- `ISSUE_TEMPLATE/bug-report.yml` — evidence a maintainer can act on: tool +
  exact arguments JSON, expected vs actual, the FULL JSON payload, server
  stderr, how the pack is located, Node/OS, installed vs published version.
- `ISSUE_TEMPLATE/asset-pack-problem.yml` — the highest-volume failure: startup
  `asset pack is not installed` and empty-row / missing-animation warnings.
  Asks for the stderr block including the `Searched:` line, a directory listing
  proving `sheet_definitions/` + `spritesheets/`, `LPC_ASSETS_DIR`, the
  `warnings` array, and the pack revision.
- `ISSUE_TEMPLATE/feature-request.yml` — new tool / argument / output / engine
  behavior, always against the upstream-fidelity default.
- `PULL_REQUEST_TEMPLATE.md` — the real acceptance gate and its constraints.

## Local Contracts

- **The asset pack is provisioned, never vendored — and the checkout is pinned.** The CI
  asset-pack checkout (LPC_ASSETS_PACK_REVISION, referenced by the `ref:` comment in `ci.yml`) is
  `9bf06be193b053db256b2536824af426de046aa2` (`depth: 1`): CI checks out
  `LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator` at that ref into
  `lpc-generator-src` and passes it as
  `LPC_ASSETS_DIR`. That env var is load-bearing: without it
  `test/run-tests.mjs` looks only for a sibling clone and the suite fails. Keep the checkout and the
  env var paired. The pin exists because `test/golden.json` records SHA-256 hashes of renders made
  from that exact art; bumping the ref requires re-running `npm run golden` and committing the
  re-recorded file in the same pass. `scripts/setup-assets.mjs` mirrors the pin with `LPC_ASSETS_REF`
  and prints the revision installed. The golden assertion runs inside `npm test`; CI adds no
  separate golden step.
- **The matrix is the portability contract:** Node 20 and 22 on `ubuntu-latest` and
  `windows-latest`, `fail-fast: false`. Path handling and `@napi-rs/canvas` behavior are the reason
  Windows is in it. Do not drop a leg to make CI green.
- **`engines.node` is `>=20.11`;** the lowest matrix Node must stay inside that floor.
- **The second step is a real assertion about failure.** With `LPC_ASSETS_DIR=/nonexistent` the
  server must exit `1` and print `asset pack is not installed` on stderr. Rewording that startup
  message in `src/index.js` breaks CI here — change both in the same pass, and the
  `asset-pack-problem.yml` wording with it.
- **Steps run under `bash -e -o pipefail`, so an expected failure must capture its own status.**
  `cmd; code=$?` aborts at `cmd` and never reaches the assignment — that is how this step sat
  untestable behind the failing test step. Write `code=0` then `cmd || code=$?`. Any new step that
  asserts on a non-zero exit needs the same shape.
- **There is no lint, typecheck, format, or publish workflow.** Nothing here gates on tooling the
  repo does not have. Do not describe CI as running checks it does not run.
- **Dependabot is a config file, not a claim that the repo runs extra checks.** It opens pull
  requests; `npm test` under CI still decides them. Keep `directory: "/"` on both ecosystems (the
  npm one must be the manifest location for security updates) and no `target-branch`. A bump to
  `@napi-rs/canvas` or `@modelcontextprotocol/sdk` is a rendering/protocol change, not a chore.
- **Issue templates must keep asking for the evidence that makes a failure diagnosable** — the full
  tool payload and the server stderr. A form that drops either field turns a reportable bug into an
  unreproducible one. Blank issues stay disabled for the same reason.
- **Missing-animation / empty-row reports are triaged as upstream gaps first.** The asset-pack form
  must keep saying so in its `description` (the `child` body ships only
  hurt/idle/jump/sit/slash/walk, so other rows are empty by design). Do not soften that into a bug.
- **Facts in templates and the PR template are checkout-verifiable.** Commands, file paths, test
  counts, the three version-declaration sites, and the `1.3.0` value must match the repo; URLs are
  limited to this repo's canonical GitHub URL and the upstream pack. No badges, no links to
  services this project does not use, no mention of Discussions or tooling that is not enabled here.

## Work Guidance

- Prefer fixing the cause in `src/` or `test/` over touching CI. The pipeline is deliberately thin.
- Keep the workflow `shell: bash` steps portable; the same file runs on Windows runners.
- When the tool surface, the result payload shape, or the asset-discovery order changes, re-read
  `ISSUE_TEMPLATE/*.yml` in the same pass: those forms quote the nine tool names, the payload keys
  (`pack: {revision}`, `truncated`/`nextOffset`, `structuredContent`), and the three candidate pack
  locations.
- The PR template mirrors `CONTRIBUTING.md`; if the acceptance gate changes, change both.

## Verification

Push or open a PR — CI is the check. Reproduce locally by running `npm ci`, then `npm test` with
`LPC_ASSETS_DIR` set to the pinned pack revision (the golden gate asserts it), then the no-assets
command. No check here validates these files: parse the
YAML with any loader and eyeball the form picker; Dependabot only reports schema problems on the
default branch.

## Child DOX Index

None. `ISSUE_TEMPLATE/` is covered above and owns no separate rules.
