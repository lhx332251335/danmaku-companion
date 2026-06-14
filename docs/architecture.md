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
  -> privacy gate
  -> screen capture
  -> model provider
  -> response parser
  -> moderation and shape limits
  -> overlay queue
```

## Process Boundaries

- Electron main process owns capture, config, providers, tray, and windows.
- Preload exposes a narrow IPC bridge.
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
  defaults, and future blacklist config.
- Next: active window detection, app blacklist enforcement, capture preview, and
  per-provider disclosure labels.
