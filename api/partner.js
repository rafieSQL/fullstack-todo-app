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
      limiter: Ratelimit.slidingWindow(8, '10 s'),
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

    const { message, transcript, tasks = [], activeTasks = [] } = body || {};
    const promptMessage = (message || transcript || '').trim();

    if (!promptMessage) {
      return res.status(400).json({ error: 'Pesan kosong' });
    }

    const rawTasks = tasks.length > 0 ? tasks : activeTasks;
    const taskList = rawTasks.map((t) => ({
      id: String(t.id || t._id || ''),
      title: String(t.title || t.text || ''),
      completed: Boolean(t.completed)
    })).filter((t) => t.id && t.title);

    const systemPrompt = `Kamu adalah JSON task parser to-do list.

DAFTAR TUGAS USER SAAT INI:
${JSON.stringify(taskList, null, 2)}

ATURAN PENCOCOKAN KETAT:
1. HANYA pilih tugas yang judulnya secara EKSPLISIT mengandung atau sama dengan kata yang diminta user.
2. JANGAN PERNAH memilih tugas lain yang namanya tidak berhubungan! (Contoh: jika user minta hapus "main bareng temen", JANGAN sentuh "Upacara 17 Agustus" atau task lain yang berbeda judul).
3. Jika user berkata "hapus semua [kata kunci]" atau "hapus [kata kunci]":
   - Cari semua task yang judulnya mengandung kata kunci tersebut.
   - Ambil SEMUA id tugas yang cocok ke dalam array "target_task_ids".
   - Set action: "BULK_DELETE_TASK".
4. Jika user minta hapus 1 tugas spesifik:
   - Ambil ID-nya ke "target_task_id" (string) dan set action: "DELETE_TASK".
5. Jika user minta menyelesaikan tugas ("selesai", "sudah", "beres", "centang [nama]"):
   - Ambil ID-nya ke "target_task_id" (string) dan set action: "COMPLETE_TASK".
6. Jika user ingin membuat tugas baru:
   - Set action: "CREATE_TASK" dan isi "taskData" ({ title, priority, category }).
7. Jika tidak ada tugas yang cocok sama sekali:
   - Set action: "CHAT" dan beri tahu user dengan jelas.

FORMAT OUTPUT WAJIB JSON:
{
  "action": "BULK_DELETE_TASK" | "DELETE_TASK" | "COMPLETE_TASK" | "CREATE_TASK" | "CHAT",
  "target_task_ids": ["id1", "id2"],
  "target_task_id": "id_tunggal_atau_null",
  "taskData": null,
  "reply": "Pesan konfirmasi yang jelas dan akurat"
}`;

    if (groq) {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Perintah: "${promptMessage}"` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.0
      });

      const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
      return res.status(200).json({
        success: true,
        data: parsed,
        ...parsed
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
            { role: 'user', content: `Perintah: "${promptMessage}"` }
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
            data: parsed,
            ...parsed
          });
        }
      }
    }

    return res.status(500).json({ error: 'No GROQ_API_KEY configured on server' });
  } catch (error) {
    console.error('Partner Error:', error);
    return res.status(200).json({
      action: 'CHAT',
      reply: 'Ada kendala teknis saat memproses permintaanmu, coba ulangi lagi ya.'
    });
  }
}
