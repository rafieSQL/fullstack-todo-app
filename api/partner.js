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

    const { transcript, clientTime, timezone, activeTasks, tasks: incomingTasks, existingTasks } = body || {};

    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const cleanTranscript = transcript.trim();
    const userTimezone = timezone || 'Asia/Jakarta';
    const refTime = clientTime || new Date().toISOString();

    const rawTasks = activeTasks || incomingTasks || existingTasks || [];
    const tasksCleanList = Array.isArray(rawTasks)
      ? rawTasks.slice(0, 15).map((t) => ({
          id: t.id || t._id,
          title: t.title,
          completed: Boolean(t.completed)
        }))
      : [];

    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    const systemInstruction = `Kamu adalah AI pengelola to-do list & kalender.
WAKTU SEKARANG: ${refTime} (${userTimezone})

DAFTAR TUGAS AKTIF SAAT INI:
${JSON.stringify(tasksCleanList, null, 2)}

ATURAN WAJIB INTENT RECOGNITION:
1. Jika pengguna menyebut kata "ubah", "selesaikan", "sudah", "beres", "done", "centang", "kelar", atau "tandai" diikuti nama tugas yang MIRIP dengan daftar di atas:
   - JANGAN PERNAH membuat task baru (DILARANG KERAS aksi CREATE / ADD / CREATE_TASKS)!
   - Cari item dengan nama paling cocok dari daftar di atas, ambil properti 'id'-nya.
   - Kembalikan response JSON:
   {
     "action": "COMPLETE_TASK",
     "target_task_id": "<ID_PERSIS_DARI_LIST>",
     "targetId": "<ID_PERSIS_DARI_LIST>",
     "reply": "Tugas '<NAMA_TUGAS>' sudah ditandai selesai!",
     "confirmation_reply": "Tugas '<NAMA_TUGAS>' sudah ditandai selesai!"
   }

2. Jika pengguna menyebut kata "hapus", "delete", atau "batalkan" diikuti nama tugas dari daftar di atas:
   - JANGAN membuat task baru!
   - Ambil properti 'id'-nya dan kembalikan action "DELETE_TASK":
   {
     "action": "DELETE_TASK",
     "target_task_id": "<ID_PERSIS_DARI_LIST>",
     "targetId": "<ID_PERSIS_DARI_LIST>",
     "reply": "Tugas '<NAMA_TUGAS>' berhasil dihapus.",
     "confirmation_reply": "Tugas '<NAMA_TUGAS>' berhasil dihapus."
   }

3. HANYA gunakan aksi "CREATE_TASKS" jika pengguna secara eksplisit ingin menambahkan hal/tugas baru yang belum ada di daftar di atas.

Return STRICT JSON matching this schema:
{
  "action": "COMPLETE_TASK" | "DELETE_TASK" | "CREATE_TASKS" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "target_task_id": "string or null",
  "targetId": "string or null",
  "title": "string",
  "workspace": "General" | "Engineering" | "Design" | "Personal",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "priority": "Low" | "Medium" | "High",
  "scheduled_at": "ISO-8601 string or null",
  "due_date": "ISO-8601 string or null",
  "duration_minutes": 30,
  "is_ambiguous": false,
  "reply": "Balasan ramah Partner",
  "confirmation_reply": "Balasan ramah Partner",
  "reply_summary": "Balasan ramah Partner",
  "tasks": [
    {
      "title": "string",
      "workspace": "General" | "Engineering" | "Design" | "Personal",
      "category": "General" | "Engineering" | "Design" | "Personal",
      "priority": "Low" | "Medium" | "High",
      "scheduled_at": "ISO-8601 string",
      "due_date": "ISO-8601 string",
      "duration_minutes": 30
    }
  ]
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
              contents: [{ role: 'user', parts: [{ text: cleanTranscript }] }],
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
            { role: 'user', content: `User Command: "${cleanTranscript}"` }
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
