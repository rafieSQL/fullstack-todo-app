import { Buffer } from 'node:buffer';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb'
    }
  }
};

export default async function handler(req, res) {
  // Handle CORS preflight
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
        // Keep original if parsing fails
      }
    }
    const { audioBase64, mimeType } = body || {};

    if (!audioBase64) {
      return res.status(400).json({ error: 'audioBase64 is required' });
    }

    const apiKey = process.env.VITE_GROQ_API_KEY || process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Groq API Key is not configured on server' });
    }

    const buffer = Buffer.from(audioBase64, 'base64');
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

    const ext = mimeType?.includes('mp4') ? 'mp4' : mimeType?.includes('ogg') ? 'ogg' : 'webm';
    
    // Construct multipart form-data payload in pure buffer
    const pre = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nid\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType || 'audio/webm'}\r\n\r\n`
    );
    const post = Buffer.from(`\r\n--${boundary}--\r\n`);
    const fullBody = Buffer.concat([pre, buffer, post]);

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: fullBody
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      return res.status(groqRes.status).json({ error: `Groq Whisper Error: ${errText}` });
    }

    const groqData = await groqRes.json();
    return res.status(200).json({ text: groqData.text });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal transcription error' });
  }
}
