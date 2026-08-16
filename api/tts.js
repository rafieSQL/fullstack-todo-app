import { Buffer } from 'node:buffer';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb'
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
        // keep as is
      }
    }

    const { text, voice = 'alloy', model = 'tts-1' } = body || {};

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Clean text from markdown formatting or special characters for smooth pronunciation
    const cleanText = text.replace(/[*_~`#\[\]\(\)\{\}>]/g, '').trim();

    const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on server' });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'tts-1',
        voice: voice || 'alloy',
        input: cleanText
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text().catch(() => '');
      return res.status(openaiRes.status).json({ error: `OpenAI TTS error: ${errText}` });
    }

    const arrayBuffer = await openaiRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length.toString());
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal TTS error' });
  }
}
