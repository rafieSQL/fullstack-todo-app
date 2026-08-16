export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // keep original
      }
    }

    const { audioBase64, mimeType = 'audio/webm' } = body || {};

    if (!audioBase64) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    // 1. Primary: Google Gemini Audio Understanding API (gemini-2.0-flash)
    if (geminiKey) {
      try {
        const cleanMime = (mimeType || 'audio/webm').split(';')[0];
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey.trim()}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      inlineData: {
                        mimeType: cleanMime,
                        data: audioBase64
                      }
                    },
                    {
                      text: `Dengarkan audio bahasa Indonesia ini secara teliti.
- Audio berisi perintah manajemen tugas / to-do list (misal: "selesaikan", "selesain", "hapus", "ilangin", "tambah", "kerjakan", nama tugas, jadwal, dsb).
- Transkripsikan kata per kata secara akurat meskipun ada logat santai, slang, atau singkatan sehari-hari (contoh: "maen" -> "main", "udah" -> "sudah", "kelar" -> "kelar").
- Hanya kembalikan teks hasil transkripsi murni tanpa tanda kutip atau penjelasan tambahan.`
                    }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.1
              }
            })
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          if (text) {
            return res.status(200).json({ text });
          }
        }
      } catch (geminiErr) {
        console.warn('Gemini Audio Transcribe error, attempting Groq fallback:', geminiErr.message);
      }
    }

    // 2. Fallback: Groq Whisper API (whisper-large-v3)
    if (groqKey) {
      try {
        const buffer = Buffer.from(audioBase64, 'base64');
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        const ext = mimeType?.includes('mp4') ? 'mp4' : mimeType?.includes('ogg') ? 'ogg' : 'webm';

        const pre = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nid\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nPerintah to-do list bahasa Indonesia: selesaikan, hapus, tambah, jadwal\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${
              mimeType || 'audio/webm'
            }\r\n\r\n`
        );
        const post = Buffer.from(`\r\n--${boundary}--\r\n`);
        const fullBody = Buffer.concat([pre, buffer, post]);

        const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqKey.trim()}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          },
          body: fullBody
        });

        if (groqRes.ok) {
          const groqData = await groqRes.json();
          if (groqData.text) {
            return res.status(200).json({ text: groqData.text.trim() });
          }
        }
      } catch (groqErr) {
        console.warn('Groq Whisper Transcribe error:', groqErr.message);
      }
    }

    return res.status(500).json({
      error: 'Audio transcription failed. Ensure GEMINI_API_KEY or GROQ_API_KEY is configured.'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Transcribe server error' });
  }
}
