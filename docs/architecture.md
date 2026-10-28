# Danmaku Companion Architecture

Danmaku Companion is a local-first desktop overlay. The first production target is
Windows, but the boundaries are intentionally cross-platform.

## Principles

- Local-first by default. Screenshots stay on device unless the user selects a
  remote endpoint.
- Provider-driven models. LM Studio, Ollama, llama.cpp server, vLLM, and hosted
  APIs should all fit behind the OpenAI-compatible contract.
- Thin overlay, thick boundaries. The overlay only renders queued comments. It
  never talks to model endpoints directly.
- No account dependency. Configuration and memory are local files.
- Explicit privacy controls. Capture can be paused globally, and future active
  app detection will enforce per-app blocking.

## Runtime Flow

```text
timer / manual trigger
  -> screen capture
  -> request budget (history compaction, current screenshot shrink)
  -> model provider (exact size check, one retry on 413 / upload reset)
  -> response parser (reasoning stripped, JSON or list fallback)
  -> sanitize and dedupe against history
  -> release timers -> overlay lanes
  -> history window + generation log
```

## Module Layout

Logic that does not need Electron lives in plain modules with unit tests in
`test/`:

- `src/shared/limits.ts`: numeric ranges used by the main process and the UI.
- `src/electron/main/providers/`: endpoint normalization, message building,
  response parsing (`responseParser.ts`), usage extraction, HTTP helpers and
  typed errors (`RequestTooLargeError`, `ModelHttpError`).
- `src/electron/main/runtime/`: runtime setting normalization and timing,
  the history window (`historyWindow.ts`), request-size budgeting
  (`requestBudget.ts`, `budgetedRequest.ts`) and the failure policy.
- `src/electron/main/configModel.ts` and `storage/`: config migration and
  sanitizing, atomic file writes, the JSON Lines generation log.
- `src/renderer/overlay/`: lane allocation and expiry timers for the overlay.

`danmakuController.ts`, `configStore.ts`, `windowManager.ts` and the capture
code stay thin wrappers around Electron APIs.

## History and Prompt Cache

Requests are kept append-only between rare compaction events so that
llama.cpp-style prefix caches keep hitting. A compaction (dropping the oldest
history screenshots in one batch down to half of the image and byte limits, or
halving the window in batch-sliding mode) costs one full re-prefill. Limits
learned from HTTP 413 responses are kept per endpoint for the session.

## Process Boundaries

- Electron main process owns capture, config, providers, tray, and windows.
  Only one instance runs at a time.
- Preload exposes a narrow IPC bridge; both windows are sandboxed and cannot
  navigate away from the app or open new windows.
- Renderer has two views:
  - settings: model, capture, style, and character controls
  - overlay: transparent danmaku surface

## Provider Roadmap

The first provider is OpenAI-compatible chat completions. The config defaults to
a local LM Studio style endpoint and can be pointed at other compatible servers.

Future providers can implement the same `ModelProvider` interface:

- Ollama native API
- llama.cpp completion API
- local OCR plus text-only model
- multi-provider fallback and routing

## Privacy Roadmap

- Current MVP: capture toggle, screenshot persistence disabled, local endpoint
  defaults, and a blacklist field that is not enforced yet.
- Next: active window detection, app blacklist enforcement, capture preview, and
  per-provider disclosure labels.
