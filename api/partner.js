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

    const tasksList = activeTasks || incomingTasks || existingTasks || [];
    const activeTasksContext =
      Array.isArray(tasksList) && tasksList.length > 0
        ? JSON.stringify(tasksList.slice(0, 15), null, 2)
        : '[]';

    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    const systemInstruction = `Kamu adalah asisten manajemen tugas & kalender AI Partner.
WAKTU SEKARANG (User): ${refTime}
TIMEZONE: ${userTimezone}

DAFTAR TUGAS AKTIF PENGGUNA SAAT INI (Konteks Memory):
${activeTasksContext}

ATURAN PENTING & PRIORITAS AKSI:
1. JIKA pengguna mengatakan "selesaikan", "sudah", "beres", "done", "kelar", "centang", atau "tandai selesai [nama tugas]":
   - Cari tugas yang paling mirip atau cocok dari DAFTAR TUGAS AKTIF di atas.
   - Set action: "COMPLETE_TASK" dan masukkan ID tugas yang cocok ke "target_task_id" / "targetId".
   - JANGAN PERNAH membuat tugas baru ("CREATE_TASKS") jika maksud pengguna adalah menyelesaikan tugas yang sudah ada!
   - Buat jawaban suara yang ramah: contoh "Siap bro, tugas 'Main bareng temen' sudah ditandai selesai!".
2. JIKA pengguna mengatakan "hapus", "delete", "batalkan [nama tugas]":
   - Cari tugas yang cocok dari DAFTAR TUGAS AKTIF di atas.
   - Set action: "DELETE_TASK" dan masukkan ID tugas ke "target_task_id" / "targetId".
3. JIKA pengguna ingin membuat tugas baru atau jadwal baru:
   - Set action: "CREATE_TASKS" dan sertakan rincian tugas di array "tasks".
4. Hitung tanggal & jam relatif ('besok', 'nanti malam jam 8', 'selasa jam 13') secara akurat berdasarkan WAKTU SEKARANG.
5. "confirmation_reply" & "reply": Balasan singkat, hangat, dan natural khas Partner.

Return STRICT JSON matching this schema:
{
  "action": "COMPLETE_TASK" | "DELETE_TASK" | "CREATE_TASKS" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "target_task_id": "ID tugas yang cocok jika COMPLETE_TASK atau DELETE_TASK, selain itu null",
  "targetId": "ID tugas yang cocok jika COMPLETE_TASK atau DELETE_TASK, selain itu null",
  "title": "Judul ringkas tugas",
  "workspace": "General" | "Engineering" | "Design" | "Personal",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "priority": "Low" | "Medium" | "High",
  "scheduled_at": "ISO-8601 string or null",
  "due_date": "ISO-8601 string or null",
  "duration_minutes": 30,
  "is_ambiguous": false,
  "confirmation_reply": "Balasan ramah Partner",
  "reply": "Balasan ramah Partner",
  "reply_summary": "Balasan ramah Partner",
  "tasks": [
    {
      "title": "Judul tugas",
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
