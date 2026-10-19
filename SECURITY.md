# Security Policy

## Scope

This server renders game spritesheets to local PNG files from a local asset
clone. By default it runs entirely offline: no network calls, no telemetry, no
secrets. Generated files are written to the `output_path` supplied by the calling MCP
client (default: `lpc-spritesheet/` under the OS temp directory).

The only command in this package that reaches the network is `lpc-spritesheet-setup`, which runs
`git clone` against the fixed upstream asset-pack URL. The server never invokes it.

## The opt-in AI exception (`design_character`)

One tool can reach the network, and only when the operator configures it: `design_character`
sends the caller's character brief (plus a compact catalog digest — itemIds, group names and
color names, never file paths or environment values) as a chat-completion request to an
OpenAI-compatible endpoint. It is inert unless **`LPC_AI_API_KEY`** is present in the server's
environment; without a key the tool returns a setup error and touches no socket. Optional
knobs: `LPC_AI_BASE_URL` (any OpenAI-compatible endpoint) and `LPC_AI_MODEL`
(`qwen3.7-plus` / `kimi-k2.5` / `qwen3.6-plus`). The key is used only as a bearer token to that
endpoint and is never written to results, logs, or files. Hosted deployments that must stay
fully offline simply never set the variable — the other twelve tools cannot make network calls.

## Reporting

Open a [GitHub issue](https://github.com/kanishka-namdeo/lpc-spritesheet-mcp/issues)
or contact the maintainer directly for anything you'd rather not discuss in
public. Please include the tool call arguments and server stderr output.

## Notes for hosted deployments

- Treat `output_path` as a filesystem-write capability: only expose this
  server to clients you trust with write access to the configured directories.
  A relative `output_path` resolves against the **server's** working directory, not the client's.
- Generated sheets inherit the upstream assets' licenses (OGA-BY / CC-BY-SA /
  GPL mix). The server writes `<name>-credits.csv` and `<name>-credits.txt` next to every sheet —
  keep them when redistributing renders.
- Without `LPC_AI_API_KEY` set, the server reads exactly one environment variable
  (`LPC_ASSETS_DIR`) and makes no network calls; it accepts no URL, remote asset source, or
  template — the pack location is a local directory.
