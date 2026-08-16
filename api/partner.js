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
    // Rate Limiter Check di baris paling awal
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
      tasks: incomingTasks,
      activeTasks,
      existingTasks
    } = body || {};

    const rawTranscript = (message || incomingTranscript || '').trim();

    if (!rawTranscript) {
      return res.status(400).json({ error: 'Message or transcript is required' });
    }

    const userTimezone = timezone || 'Asia/Jakarta';
    const refTime = clientTime || new Date().toISOString();

    const rawTasks = incomingTasks || activeTasks || existingTasks || [];
    const tasksCleanList = Array.isArray(rawTasks)
      ? rawTasks.slice(0, 20).map((t) => ({
          id: t.id || t._id,
          title: t.title,
          completed: Boolean(t.completed)
        }))
      : [];

    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    const systemInstruction = `Daftar Tugas Pengguna Saat Ini:
${JSON.stringify(tasksCleanList, null, 2)}

WAKTU SEKARANG: ${refTime} (${userTimezone})

ATURAN UTAMA:
- Jika user mengatakan "hapus", "buang", "delete", "batalkan", atau "hilangkan [nama tugas]":
  Action = "DELETE_TASK", target_task_id = <ID tugas yang cocok dari daftar di atas>. JANGAN PERNAH CREATE!
- Jika user mengatakan "selesai", "sudah", "beres", "done", "kelar", "centang", atau "tandai [nama tugas]":
  Action = "COMPLETE_TASK", target_task_id = <ID tugas yang cocok dari daftar di atas>. JANGAN PERNAH CREATE!
- HANYA gunakan action "CREATE_TASK" atau "CREATE_TASKS" jika user ingin mencatat to-do baru yang belum ada.

Format JSON Output:
{
  "action": "DELETE_TASK" | "COMPLETE_TASK" | "CREATE_TASK" | "CREATE_TASKS" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "QUERY",
  "target_task_id": "string id atau null",
  "targetId": "string id atau null",
  "title": "Judul tugas jika create baru",
  "workspace": "General" | "Engineering" | "Design" | "Personal",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "priority": "Low" | "Medium" | "High",
  "scheduled_at": "ISO-8601 string or null",
  "due_date": "ISO-8601 string or null",
  "duration_minutes": 30,
  "reply": "Pesan konfirmasi singkat khas Partner",
  "confirmation_reply": "Pesan konfirmasi singkat khas Partner"
}`;

    // Option A: Gemini API (if GEMINI_API_KEY is available)
    if (geminiKey) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey.trim()}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: rawTranscript }] }],
              systemInstruction: { parts: [{ text: systemInstruction }] },
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1
              }
            })
          }
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            const parsed = JSON.parse(text);
            return res.status(200).json({ success: true, data: parsed });
          }
        }
      } catch (geminiErr) {
        console.warn('Gemini route error, falling back to Groq:', geminiErr.message);
      }
    }

    // Option B: Groq Llama 3 (if GROQ_API_KEY is available)
    if (groqKey) {
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
            { role: 'user', content: `User Command: "${rawTranscript}"` }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      if (groqRes.ok) {
        const groqData = await groqRes.json();
        const content = groqData.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          return res.status(200).json({ success: true, data: parsed });
        }
      }
    }

    return res.status(500).json({
      error: 'No AI API Key (GEMINI_API_KEY or GROQ_API_KEY) configured on server.'
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Partner Error' });
  }
}
