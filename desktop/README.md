# VoiceData Desktop

macOS menu-bar companion for VoiceData. While **Meeting-Aufnahme** is on, it records the microphone
(`Ich`) and system audio (`Teilnehmer`, e.g. Zoom/Teams/Meet), transcribes live in 5–20 s chunks
and stores every meeting under `~/Library/Application Support/VoiceData Desktop/sessions/`.
Closing the window keeps it running in the menu bar (`VD` / `● VD` while recording).

## After the meeting

A meeting ends after 5 minutes without speech or when recording is switched off. Then:

- **Summary** (_Einstellungen › Nach dem Meeting_, on by default): overview, key points by topic
  and to-dos via OpenAI `gpt-4o-mini`, using the OpenAI key from Settings even when transcription
  runs locally. Meetings with fewer than 30 words are skipped; any meeting can be summarized
  manually from its detail view.
- **Conversation statistics** (no AI, always shown): talk share, speaking time, words, pace,
  questions and longest monologue for `Ich` vs `Teilnehmer`.
- **n8n webhook** (optional): `POST` JSON to the configured URL with `event`
  (`meeting.completed` / `test`), `meeting`, `summary`, `metrics`, `transcript` and `markdown`
  (header `X-VoiceData-Event`). Sent once without retry; resend from the detail view.
  Local/LAN n8n URLs are allowed.

Summary prompts and statistics are adapted from
[call.md](https://github.com/video-db/call.md) without its VideoDB dependency.

## Requirements

- macOS 14.2+ (system audio via CoreAudio Tap)
- Local engine: `brew install whisper-cpp` (provides `whisper-cli`), then download a model in
  _Einstellungen_.
- OpenAI engine: API key with access to `gpt-transcribe`.

## Commands

```bash
npm install
npm test          # unit tests (segmenter, WAV, session store)
npm run typecheck
npm start         # dev run – system audio permission is attributed to the terminal here
npm run pack:mac  # release/mac-arm64/VoiceData Desktop.app – use this to test system audio
```

On first start of the recording macOS asks for **Microphone** and **System Audio Recording**
(System Settings › Privacy & Security). Use headphones: on speakers the participants' voices also
reach the microphone and get transcribed twice.
