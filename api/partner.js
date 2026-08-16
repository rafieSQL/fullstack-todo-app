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
      limiter: Ratelimit.slidingWindow(8, '10 s'),
      analytics: true
    })
  : null;

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
    // Rate Limiter Check
    if (ratelimit) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '127.0.0.1';
      const { success, reset } = await ratelimit.limit(`rate_${ip}`);

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
      } catch {
        // keep original
      }
    }

    const {
      message,
      transcript: incomingTranscript,
      clientTime,
      timezone,
      tasks = [],
      activeTasks = [],
      existingTasks = []
    } = body || {};

    const rawMessage = (message || incomingTranscript || '').trim();

    if (!rawMessage) {
      return res.status(400).json({ error: 'Pesan kosong' });
    }

    const userTimezone = timezone || 'Asia/Jakarta';
    const refTime = clientTime || new Date().toISOString();

    const rawTasks = tasks.length > 0 ? tasks : activeTasks.length > 0 ? activeTasks : existingTasks;
    const simplifiedTasks = rawTasks.slice(0, 30).map((t) => ({
      id: t.id || t._id,
      title: t.title || t.text,
      completed: Boolean(t.completed)
    }));

    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    const systemInstruction = `Kamu adalah parser perintah sistem to-do list berbasis JSON. Jangan membuat lelucon atau kalimat bertele-tele.
WAKTU SEKARANG: ${refTime} (${userTimezone})

DAFTAR TUGAS SAAT INI:
${JSON.stringify(simplifiedTasks)}

PEMETAAN INTENT:
1. "BULK_DELETE_TASK": Jika pengguna meminta menghapus SEMUA tugas atau banyak tugas yang cocok/duplikat (misal: "hapus semua main bareng", "bersihkan"). Isi 'target_task_ids' dengan array SEMUA ID yang cocok dari daftar di atas.
2. "DELETE_TASK": Jika pengguna meminta hapus satu tugas spesifik. Ambil ID yang cocok dari daftar ke 'target_task_id'.
3. "COMPLETE_TASK": Jika pengguna menyebut selesai/sudah/kelar/centang/tandai. Ambil ID yang cocok dari daftar ke 'target_task_id'.
4. "CREATE_TASK": Jika pengguna ingin membuat tugas baru. Isi 'taskData' ({ title, priority, category }).
5. "CHAT": Pertanyaan umum di luar operasi tugas.

Format JSON Output Murni:
{
  "action": "BULK_DELETE_TASK" | "DELETE_TASK" | "COMPLETE_TASK" | "CREATE_TASK" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "CHAT",
  "target_task_id": "string id atau null",
  "target_task_ids": ["id1", "id2"],
  "taskData": {
    "title": "string",
    "priority": "Low" | "Medium" | "High",
    "category": "General" | "Engineering" | "Design" | "Personal",
    "scheduled_at": "ISO-8601 string or null"
  },
  "title": "string",
  "priority": "Low" | "Medium" | "High",
  "workspace": "General" | "Engineering" | "Design" | "Personal",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "reply": "Konfirmasi singkat maksimal 1 kalimat"
}`;

    // Option A: Gemini API (gemini-2.0-flash / 2.5) with temperature 0.0
    if (geminiKey) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey.trim()}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\nPerintah: "${rawMessage}"\n\nRespon JSON:` }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.0
              }
            })
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          let rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
          rawText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsedResult = JSON.parse(rawText);
          return res.status(200).json({
            success: true,
            data: parsedResult,
            ...parsedResult
          });
        }
      } catch (geminiErr) {
        console.warn('Gemini route error, trying Groq:', geminiErr.message);
      }
    }

    // Option B: Groq Llama 3 with temperature 0.0
    if (groqKey) {
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqKey.trim()}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: `Perintah: "${rawMessage}"` }
            ],
            temperature: 0.0,
            response_format: { type: 'json_object' }
          })
        });

        if (groqRes.ok) {
          const groqData = await groqRes.json();
          const content = groqData.choices?.[0]?.message?.content;
          if (content) {
            const parsedResult = JSON.parse(content);
            return res.status(200).json({
              success: true,
              data: parsedResult,
              ...parsedResult
            });
          }
        }
      } catch (groqErr) {
        console.warn('Groq route error:', groqErr.message);
      }
    }

    return res.status(200).json({
      action: 'CHAT',
      reply: 'Ada kendala teknis saat memproses permintaanmu, coba ulangi lagi ya.'
    });
  } catch (error) {
    console.error('Partner API Error:', error);
    return res.status(200).json({
      action: 'CHAT',
      reply: 'Ada kendala teknis saat memproses permintaanmu, coba ulangi lagi ya.'
    });
  }
}
