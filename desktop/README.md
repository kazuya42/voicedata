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

- Apple Silicon Mac, macOS 14.2+ (system audio via CoreAudio Tap)
- Local engine: nothing to install – the app ships its own `whisper-cli` (whisper.cpp, Metal).
  Download a model in _Einstellungen_. (`npm start` in development uses Homebrew's
  `whisper-cli` instead: `brew install whisper-cpp`.)
- OpenAI engine: API key with access to `gpt-transcribe`.

## Commands

```bash
npm install
npm test          # unit tests
npm run typecheck
npm start         # dev run – system audio permission is attributed to the terminal here
npm run pack:mac  # release/mac-arm64/VoiceData Desktop.app – local test build, not notarized
npm run dist:mac  # signed + notarized DMG and ZIP in release/ for other Macs
```

`pack:mac`/`dist:mac` first build `vendor/whisper-cli` from whisper.cpp v1.9.5 if it is missing
(`scripts/build-whisper.sh`; needs Xcode CLT, `cmake`, `ninja`).

### Release for other Macs

Needs the _Developer ID Application_ certificate in the keychain and notarization credentials
stored once as keychain profile `voicedata-notary`:

```bash
xcrun notarytool store-credentials voicedata-notary \
  --apple-id <apple-id-email> --team-id QCXF9R86DK
# prompts for an app-specific password (appleid.apple.com › Sign-In & Security)
npm run dist:mac
```

Ship `release/VoiceData Desktop-<version>-arm64.dmg`. On the other Mac: open the DMG, drag the
app to _Applications_, start it, allow Microphone and System Audio Recording on first recording,
download a model in _Einstellungen_. Bump `version` in `package.json` for each release.

On first start of the recording macOS asks for **Microphone** and **System Audio Recording**
(System Settings › Privacy & Security). Use headphones: on speakers the participants' voices also
reach the microphone and get transcribed twice.
