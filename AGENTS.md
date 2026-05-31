# Repository Guidelines

## Project-Specific Hard Rules

This fork is used as an external API image-generation client only. Never design,
test, deploy, or optimize for local model inference.

- Do not require or provision GPU/CUDA environments for this project.
- Do not add features that depend on local SD/Flux/Qwen/etc. model execution.
- External providers such as OpenAI/Sub2API/Gemini are the only supported
  generation path for this deployment.
- Server deployments must use CPU-compatible dependencies and configuration,
  for example `uv sync --extra cpu --frozen`, `device: cpu`, and
  `precision: float32`.
- Tests and operational checks must not assume CUDA, GPU availability, or local
  model files.

## Project Structure & Module Organization

InvokeAI is a Python application with a bundled React frontend and separate docs site. Backend code lives in `invokeai/app`, `invokeai/backend`, `invokeai/configs`, and `invokeai/invocation_api`. The web UI is in `invokeai/frontend/web`, with source under `src/app`, `src/common`, `src/features`, and `src/services`. Backend tests live in `tests/`; frontend unit tests are colocated as `*.test.ts` or `*.test.tsx`. Current docs are in `docs/`; `docs-old/` contains legacy material.

## Build, Test, and Development Commands

Run commands from the repo root unless noted.

- `uv sync --extra test --extra dev`: install Python dev/test dependencies.
- `invokeai-web`: run the backend web app after environment setup.
- `make test` or `pytest ./tests`: run backend tests, excluding slow tests.
- `pytest ./tests -m ""`: run all backend tests, including `slow`.
- `make ruff`: format Python with Ruff.
- `make mypy`: run the configured Python type check.
- `make frontend-install`: install web dependencies with `pnpm`.
- `make frontend-dev`: start Vite on `localhost:5173`.
- `make frontend-build`: lint, test, and build the frontend.
- `make frontend-test`: run Vitest once.
- `make docs`: serve the docs site locally.

## Coding Style & Naming Conventions

Use UTF-8, LF line endings, final newlines, and trimmed trailing whitespace. Python uses 4-space indentation; other files default to 2 spaces. Ruff uses a 120-character line length and import sorting. MyPy and Pyright are strict for covered code. Avoid relative Python imports. Frontend code uses TypeScript, ESLint, Prettier, and `pnpm fix`.

## Testing Guidelines

Backend tests use `pytest`; name files `test_*.py` and functions `test_*`. Mark expensive or hardware-dependent cases with `@pytest.mark.slow` so the default suite remains fast. Coverage targets `invokeai`, requires 85%, and writes reports to `coverage/`. Frontend tests use Vitest and should stay beside the code they cover.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style prefixes such as `fix:`, `feat:`, `docs:`, and `chore:`. Keep commits scoped and imperative, for example `fix: expose external provider settings`. PRs should include a behavior summary, linked issue when applicable, test results, and screenshots or recordings for visible UI changes. Avoid generated build output unless required.

## Security & Configuration Tips

Do not commit local model files, secrets, `.env` files, virtual environments, or `node_modules`. For authentication, storage, model loading, or external provider changes, add focused regression tests and note migration or configuration impacts in the PR.
