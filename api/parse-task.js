import Groq from 'groq-sdk';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb'
    }
  }
};

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN
      })
    : null;

const ratelimit = redis
  ? new Ratelimit({
      redis: redis,
      limiter: Ratelimit.slidingWindow(20, '10 s'),
      analytics: true
    })
  : null;

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (ratelimit) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '127.0.0.1';
      const { success, reset } = await ratelimit.limit(`parse_rate_${ip}`);

      if (!success) {
        return res.status(429).json({
          error: 'Terlalu banyak permintaan. Silakan tunggu beberapa detik.',
          retryAfter: reset
        });
      }
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {}
    }

    const {
      text,
      defaultCategory = 'General',
      defaultPriority = 'medium',
      timezone = 'Asia/Jakarta',
      clientTime
    } = body || {};

    const rawText = (text || '').trim();
    if (!rawText) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const refTime = clientTime || new Date().toISOString();

    const systemPrompt = `Kamu adalah NLP Task Extractor cerdas berbasis JSON.
WAKTU SEKARANG: ${refTime} (Timezone: ${timezone})

TUGAS:
Ubah kalimat pengguna menjadi satu atau lebih daftar task terstruktur.
- Jika pengguna memasukkan beberapa aksi/jam/kegiatan sekaligus (contoh: "jam 6 beli kopi, jam 7 olahraga, jam 8 meeting", atau "besok saya akan membeli kopi di jam 6, dan jam 7, dan jam 8 di hari senin tanggal 17 agustus 2026"), PECAH menjadi array berisi masing-masing task secara terpisah.
- Deteksi tanggal, hari, dan jam relatif/spesifik untuk dikonversi ke format ISO string (dueDate / scheduled_at).
- Tentukan kategori ("General", "Engineering", "Design", "Personal") & prioritas ("low", "medium", "high") sesuai konteks kalimat, atau gunakan default (${defaultCategory} / ${defaultPriority}).
- Bersihkan judul task agar rapi dan ringkas tanpa imbuhan tidak perlu.

FORMAT JSON OUTPUT MURNI:
{
  "tasks": [
    {
      "title": "Beli kopi",
      "category": "Personal",
      "priority": "medium",
      "dueDate": "2026-08-17T06:00:00.000Z",
      "due_date": "2026-08-17T06:00:00.000Z",
      "duration_minutes": 30
    }
  ]
}`;

    if (groq) {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: rawText }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.0
      });

      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{"tasks":[]}');
      return res.status(200).json({
        success: true,
        tasks: Array.isArray(parsed.tasks) && parsed.tasks.length > 0
          ? parsed.tasks
          : [{ title: rawText, category: defaultCategory, priority: defaultPriority }]
      });
    }

    const apiKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;
    if (apiKey) {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: rawText }
          ],
          temperature: 0.0,
          response_format: { type: 'json_object' }
        })
      });

      if (groqRes.ok) {
        const groqData = await groqRes.json();
        const content = groqData.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          return res.status(200).json({
            success: true,
            tasks: Array.isArray(parsed.tasks) && parsed.tasks.length > 0
              ? parsed.tasks
              : [{ title: rawText, category: defaultCategory, priority: defaultPriority }]
          });
        }
      }
    }

    // Fallback if no LLM key
    return res.status(200).json({
      success: true,
      tasks: [{ title: rawText, category: defaultCategory, priority: defaultPriority }]
    });
  } catch (error) {
    console.error('Parse Task Error:', error);
    return res.status(200).json({
      success: true,
      tasks: [
        {
          title: req.body?.text || 'Tugas Baru',
          category: req.body?.defaultCategory || 'General',
          priority: req.body?.defaultPriority || 'medium'
        }
      ]
    });
  }
}
