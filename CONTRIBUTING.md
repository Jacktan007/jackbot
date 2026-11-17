# Contributing to jackbot

Thanks for your interest. This project is MIT licensed. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Before you start

- Open an issue before a large change, so we can confirm the scope.
- Keep existing copyright and upstream attribution intact.
- Do not add a custom or more restrictive license.

## Run it locally

You need Node.js 22+ and pnpm 10.

```bash
pnpm install
JACKBOT_MODEL=stub pnpm dev
```

The stub model needs no API key. Use your own key only when you want a live model. Details are in the README.

## What we review

- Changes should be small, tested, and described in the pull request.
- Do not commit secrets, tokens, or local data directories.
- Do not assume unpublished internal features are already in `main`.

## Issues and pull requests

Use GitHub issues for bugs and proposals. Pull requests should explain what changed and how you checked it. Maintainers will review before anything is merged.
