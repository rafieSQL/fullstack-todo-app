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
      tasks = [],
      activeTasks = [],
      existingTasks = []
    } = body || {};

    const rawMessage = (message || incomingTranscript || '').trim();

    if (!rawMessage) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userTimezone = timezone || 'Asia/Jakarta';
    const refTime = clientTime || new Date().toISOString();

    const rawTasks = tasks.length > 0 ? tasks : activeTasks.length > 0 ? activeTasks : existingTasks;
    const simplifiedTasks = rawTasks.slice(0, 20).map((t) => ({
      id: t.id || t._id,
      title: t.title || t.text,
      completed: Boolean(t.completed)
    }));

    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    const systemInstruction = `Kamu adalah asisten to-do list cerdas berbahasa Indonesia santai dan ramah.
WAKTU SEKARANG: ${refTime} (${userTimezone})

DAFTAR TUGAS AKTIF PENGGUNA SAAT INI:
${JSON.stringify(simplifiedTasks, null, 2)}

ATURAN PEMAHAMAN INTENT & PENCOCOKAN FLEKSIBEL (FUZZY MATCHING):
1. Pahami Sinonim & Bahasa Santai Sehari-hari:
   - SELESAI / COMPLETE: "selesai", "selesain", "kelar", "beres", "udah", "centang", "tandai", "beresin", "sudah selesai", "done".
   - HAPUS / DELETE: "hapus", "buang", "ilangin", "delete", "singkirkan", "batalkan", "hapusin".
   - BULK DELETE: "hapus semua [nama]", "bersihkan semua [nama]", "delete all [nama]", "hapus duplikat [nama]".
   - BUAT / CREATE: "tambah", "bikin", "ingatkan", "buat to-do", "jadwalkan", "catat", "tambahin".

2. Gunakan PENCOCOKAN FLEKSIBEL (Fuzzy Matching):
   - Jika pengguna berkata "hapus semua [nama]" atau ada banyak task duplikat yang ingin dihapus:
     Set action = "BULK_DELETE_TASK", dan kumpulkan SEMUA id task yang cocok ke dalam array "target_task_ids": ["id1", "id2", ...].
   - Jika pengguna menyebut nama yang mirip untuk 1 task (contoh: "maen bareng" cocok dengan "Main bareng temen"), PILIH TASK TERSEBUT dan ambil 'id'-nya sebagai 'target_task_id'!
   - Jangan kaku terhadap typo, variasi pelafalan lisan, atau imbuhan kata.
   - JANGAN PERNAH membuat task baru jika maksud pengguna adalah menyelesaikan atau menghapus task yang mirip di atas!

3. Format Output JSON:
{
  "action": "BULK_DELETE_TASK" | "COMPLETE_TASK" | "DELETE_TASK" | "CREATE_TASK" | "CREATE_TASKS" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "CHAT",
  "target_task_ids": ["ID1", "ID2"],
  "target_task_id": "ID_TUGAS_ATAU_NULL",
  "targetId": "ID_TUGAS_ATAU_NULL",
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
  "scheduled_at": "ISO-8601 string or null",
  "due_date": "ISO-8601 string or null",
  "reply": "Kalimat konfirmasi santai dan singkat untuk diucapkan ke user",
  "confirmation_reply": "Kalimat konfirmasi santai dan singkat untuk diucapkan ke user"
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
              contents: [{ role: 'user', parts: [{ text: `${systemInstruction}\n\nPesan Pengguna: "${rawMessage}"\n\nRespon JSON:` }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1
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

    // Option B: Groq Llama 3 (if GROQ_API_KEY is available)
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
              { role: 'user', content: `Pesan Pengguna: "${rawMessage}"` }
            ],
            temperature: 0.1,
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
