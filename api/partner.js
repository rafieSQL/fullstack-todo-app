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
    const simplifiedTasks = rawTasks.slice(0, 30).map((t) => ({
      id: t.id || t._id,
      title: t.title || t.text,
      completed: Boolean(t.completed)
    }));

    const systemPrompt = `Kamu adalah JSON task action parser to-do list. Tugasmu mengekstrak aksi ke format JSON valid tanpa basa-basi.

DAFTAR TUGAS AKTIF:
${JSON.stringify(simplifiedTasks)}

ATURAN HAPUS BANYAK (BULK DELETE):
1. Jika pengguna meminta menghapus jamak/semua (contoh: "hapus semua main bareng", "bersihkan task main bareng temen", "delete semua to-do", "hapus yang namanya X"):
   - Cari SEMUA tugas yang mengandung atau mirip kata kunci tersebut.
   - Kumpulkan SEMUA id-nya ke dalam array "target_task_ids".
   - Set action: "BULK_DELETE_TASK".
   - Jika pengguna minta "hapus semua tugas" tanpa filter, masukkan SEMUA id di daftar tugas.

ATURAN AKSI LAINNYA:
- DELETE_TASK: Hapus 1 tugas spesifik -> "target_task_id" (string)
- COMPLETE_TASK: Selesai/centang tugas -> "target_task_id" (string)
- CREATE_TASK: Buat tugas baru -> "taskData" ({ title, priority, category })
- CHAT: Pertanyaan umum / ngobrol biasa

FORMAT OUTPUT WAJIB JSON:
{
  "action": "BULK_DELETE_TASK" | "DELETE_TASK" | "COMPLETE_TASK" | "CREATE_TASK" | "CHAT",
  "target_task_ids": ["id1", "id2"],
  "target_task_id": "id_tunggal_atau_null",
  "taskData": null,
  "reply": "Siap, X tugas berhasil dihapus!"
}`;

    if (groq) {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: promptMessage }
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
            { role: 'user', content: promptMessage }
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
