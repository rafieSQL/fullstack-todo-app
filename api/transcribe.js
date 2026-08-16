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

    const { audio, audioBase64: altAudio, mimeType = 'audio/webm' } = body || {};
    const audioData = audio || altAudio;

    if (!audioData) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    // 1. Primary: Google Gemini Audio Understanding API (gemini-2.0-flash / 2.5) with temperature 0.0
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
                        data: audioData
                      }
                    },
                    {
                      text: `Transkripsikan perintah suara to-do list berikut secara akurat dan literal dalam bahasa Indonesia.
ATURAN KETAT:
- Jangan tambahkan salam pembuka/penutup, jangan berasumsi, dan jangan membuat lelucon.
- Jika audio hanya berisi hening, nafas, desah, atau noise tanpa kata yang jelas, kembalikan teks kosong "" tanpa karakter apa pun.
- Jika ada kata yang jelas, transkripsikan kata per kata secara murni tanpa tanda kutip.`
                    }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.0
              }
            })
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          let text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          text = text.replace(/^["']|["']$/g, '').trim();
          // Suppress common silence hallucinations
          if (/^(hai\s*bang|halo|hello|tes|test|terima\s*kasih|thank\s*you)$/i.test(text)) {
            text = '';
          }
          return res.status(200).json({ text });
        }
      } catch (geminiErr) {
        console.warn('Gemini Audio Transcribe error, attempting Groq fallback:', geminiErr.message);
      }
    }

    // 2. Fallback: Groq Whisper API (whisper-large-v3)
    if (groqKey) {
      try {
        const buffer = Buffer.from(audioData, 'base64');
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        const ext = mimeType?.includes('mp4') ? 'mp4' : mimeType?.includes('ogg') ? 'ogg' : 'webm';

        const pre = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nid\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n0.0\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nPerintah to-do list: selesaikan, hapus semua, tambah\r\n` +
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
          let text = groqData.text ? groqData.text.trim() : '';
          text = text.replace(/^["']|["']$/g, '').trim();
          return res.status(200).json({ text });
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
