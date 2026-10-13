# Security Policy

## Scope

This server renders game spritesheets to local PNG files from a local asset
clone. It runs entirely offline: no network calls, no telemetry, no secrets.
Generated files are written to the `output_path` supplied by the calling MCP
client (default: the package's `output/` directory).

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
- The server reads exactly one environment variable (`LPC_ASSETS_DIR`) and makes no network calls;
  nothing here accepts a URL, a remote asset source, or a template.
