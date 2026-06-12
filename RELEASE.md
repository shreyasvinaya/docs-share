# Release Process

Formal releases are not automated yet.

Before tagging a release:

1. Run `bun run check`.
2. Run `bun audit`.
3. Build the Docker image with `docker build -t docs-share:<version> .`.
4. Smoke test a fresh deployment with `docker compose up`.
5. Update `CHANGELOG.md`.
6. Tag the release.

CLI npm publishing should be added only after the package naming and registry ownership are finalized.
