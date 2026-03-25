# StudyBox-AI

StudyBox-AI is a local-first study workspace built with React, TypeScript, Vite, and the `@runanywhere/web` SDK. The app runs AI models directly in the browser for chat, vision, voice, note-making, quiz generation, flashcards, and concept mapping.

No traditional backend is required for inference. Models are downloaded on first use, cached in the browser, and reused locally.

## Features

| Area | What it does |
| --- | --- |
| Chat | Streams responses from an on-device language model |
| Vision | Analyzes a camera frame or uploaded image with a local vision-language model |
| Voice | Uses local VAD, STT, LLM, and TTS for a speak-and-response loop |
| Smart Notes | Summarizes study history into editable notes |
| Flashcards | Generates review cards from notes or prior sessions |
| Quiz | Builds multiple-choice quizzes from study material |
| Concept Map | Turns study material into a visual concept map |
| Profile | Tracks streaks, XP, study activity, and achievements |
| Pomodoro | Includes a focus timer with ambient audio |
| Settings | Lets you choose theme, preferred models, and inspect acceleration mode |

## Tech Stack

- React 19
- TypeScript
- Vite 6
- `@runanywhere/web`
- `@runanywhere/web-llamacpp`
- `@runanywhere/web-onnx`
- `react-markdown` + KaTeX for rich output rendering

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## How It Works

The app initializes the RunAnywhere SDK in [src/runanywhere.ts](src/runanywhere.ts), registers local model definitions, and loads models by category only when a feature needs them.

Key runtime pieces:

- LLM and VLM features use `llama.cpp` through `@runanywhere/web-llamacpp`
- STT, TTS, and VAD use ONNX-backed models through `@runanywhere/web-onnx`
- Vision inference runs through a dedicated web worker
- Downloaded model files are cached in the browser

## Persistence

Most user-facing state is stored in `public/userdata.json` during local development, including:

- active tab
- theme
- preferred models
- notes
- history
- streak / XP stats
- pomodoro settings
- pinned answers

In dev mode, the Vite config exposes a local `POST /__userdata` endpoint that writes changes back to `public/userdata.json`. In production, the app still reads `userdata.json`, but the dev-only write endpoint is not available.

## Project Structure

```text
src/
  App.tsx                    # Main app shell and state orchestration
  main.tsx                   # React entry point
  runanywhere.ts             # SDK init, model catalog, runtime wiring
  hooks/
    useModelLoader.ts        # Shared model download/load hook
  components/
    ChatTab.tsx
    VisionTab.tsx
    VoiceTab.tsx
    SmartNotesTab.tsx
    FlashcardsTab.tsx
    QuizTab.tsx
    ConceptMapTab.tsx
    ProfileTab.tsx
    SettingsTab.tsx
    ModelBanner.tsx
    MarkdownContent.tsx
  lib/
    userdata.ts              # Load/save persisted app data
    studyOutput.ts           # Helpers for parsing model output
  workers/
    vlm-worker.ts            # Vision worker entry
  styles/
    index.css                # Global styling and theme system
public/
  userdata.template.json     # Default persisted data template
  userdata.json              # Local persisted data for development
```

## Models

The bundled catalog in [src/runanywhere.ts](src/runanywhere.ts) currently includes:

- `lfm2-350m-q4_k_m` for lightweight chat
- `lfm2-1.2b-tool-q4_k_m` for stronger local language tasks
- `lfm2-vl-450m-q4_0` for vision
- Whisper Tiny English for speech-to-text
- Piper Lessac for text-to-speech
- Silero VAD for speech detection

You can add or replace models by editing the `MODELS` array in `src/runanywhere.ts`.

## Build

```bash
npm run build
```

The Vite config copies the required WASM runtime assets into `dist/assets` during production builds.

## Deployment

This project needs cross-origin isolation headers for SharedArrayBuffer and multi-threaded WASM support.

### Vercel

`vercel.json` is already configured with the required headers.

### Other Static Hosts

Serve all app responses with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

## Browser Requirements

- Recent Chrome or Edge recommended
- WebAssembly support
- SharedArrayBuffer support
- OPFS/browser storage for model caching
- Camera and microphone permissions for vision and voice features

## Notes

- The first run can take time because models are downloaded locally.
- Voice and vision features depend on browser permissions and supported hardware/runtime acceleration.
- The production app is static; the editable `userdata.json` write flow is a local-development convenience.

## License

MIT
