# .github/

## Purpose

The repository's only automated gate. CI runs the test suite and asserts the server's
no-assets behavior.

## Ownership

- `workflows/ci.yml` — trigger, matrix, asset-pack checkout, `npm test`, graceful-failure check.

## Local Contracts

- **The asset pack is provisioned, never vendored.** CI checks out
  `LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator` at depth 1 into
  `lpc-generator-src` and passes it as `LPC_ASSETS_DIR`. That env var is load-bearing: without it
  `test/run-tests.mjs` looks only for a sibling clone and the suite fails. Keep the checkout and the
  env var paired.
- **The matrix is the portability contract:** Node 20 and 22 on `ubuntu-latest` and
  `windows-latest`, `fail-fast: false`. Path handling and `@napi-rs/canvas` behavior are the reason
  Windows is in it. Do not drop a leg to make CI green.
- **`engines.node` is `>=20.11`;** the lowest matrix Node must stay inside that floor.
- **The second step is a real assertion about failure.** With `LPC_ASSETS_DIR=/nonexistent` the
  server must exit `1` and print `asset pack is not installed` on stderr. Rewording that startup
  message in `src/index.js` breaks CI here — change both in the same pass.
- **There is no lint, typecheck, format, or publish workflow.** Nothing here gates on tooling the
  repo does not have. Do not describe CI as running checks it does not run.

## Work Guidance

- Prefer fixing the cause in `src/` or `test/` over touching CI. The pipeline is deliberately thin.
- Keep the workflow `shell: bash` steps portable; the same file runs on Windows runners.

## Verification

Push or open a PR — CI is the check. Reproduce locally by running `npm ci`, then `npm test` with
`LPC_ASSETS_DIR` set, then the no-assets command.

## Child DOX Index

None.
