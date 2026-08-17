---
name: audio-voice-streaming
description: Protection guidelines and architecture rules for Audio recording, MediaRecorder, Whisper, Groq, and Voice Partner pipelines.
---

# Audio & Voice Streaming Handling Skill

## 1. Protected Voice Pipeline (Zero Unprompted Modifications)
- **Core Voice Architecture**:
  - Alur rekaman browser via `MediaRecorder`, pengumpulan data audio chunks/blobs, serta transmisi ke Whisper API adalah area terlindungi (*Protected Zone*).
  - DILARANG memodifikasi, memotong, atau merefaktor pipeline pemrosesan suara kecuali ada instruksi eksplisit dari user untuk mengubah Voice Partner.
- **Audio Lifecycle Management**:
  - Selalu pastikan `MediaStreamTrack` dimatikan (`track.stop()`) dengan benar setelah rekaman selesai atau dibatalkan untuk mencegah kebocoran memori/indikator mikrofon browser menyala terus.
  - Tangani error izin mikrofon (*Permission Denied*) dengan UI feedback yang jelas, bukan silent fail.

## 2. API Integration Integrity (Whisper & Groq)
- **Safe Transcriptions**:
  - Hasil transkripsi suara dari Whisper hanya diteruskan ke fungsi parser teks / state handler yang telah ditentukan.
  - Jangan mencampuradukkan format pesan Voice Partner dengan struktur to-do database tanpa melalui serializer yang valid.
- **Error & Timeout Boundaries**:
  - Bungkus seluruh request async ke Whisper dan Groq dalam block `try...catch`.
  - Sediakan fallback state agar UI tidak macet (*hang*) jika koneksi API terputus.

## 3. UI Isolation
- Tombol mikrofon (`Tell Partner`), visualizer gelombang suara, dan modal voice status harus terisolasi dari re-render berlebihan.
- Perubahan styling atau tata letak pada Task List, Calendar, atau Focus Mode TIDAK BOLEH menggeser atau merusak posisi dan fungsi tombol voice partner.
