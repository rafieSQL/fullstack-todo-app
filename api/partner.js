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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS, POST');
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
        // keep original
      }
    }

    const { transcript, clientTime, timezone, activeTasks } = body || {};

    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const cleanTranscript = transcript.trim();
    const userTimezone = timezone || 'Asia/Jakarta';
    const refTime = clientTime || new Date().toISOString();

    const activeTasksContext =
      Array.isArray(activeTasks) && activeTasks.length > 0
        ? JSON.stringify(activeTasks.slice(0, 15), null, 2)
        : '[]';

    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    const systemInstruction = `Kamu adalah AI Partner di Task Registry & Calendar.
WAKTU SEKARANG (User): ${refTime}
TIMEZONE: ${userTimezone}

DAFTAR TUGAS AKTIF SAAT INI (Konteks Memory):
${activeTasksContext}

ATURAN COCOK TUGAS & AKSI:
1. Jika user ingin menyelesaikan tugas (contoh: "selesaikan tugas laporan", "tandai meeting tadi kelar", "tugas belajar udah beres"):
   Cari task yang paling relevan dari DAFTAR TUGAS AKTIF, masukkan ID-nya ke 'target_task_id' dan pilih action 'COMPLETE_TASK'.
2. Jika user ingin menghapus/membatalkan tugas (contoh: "hapus tugas laporan", "batalkan jadwal meeting"):
   Cari task yang cocok dari DAFTAR TUGAS AKTIF, masukkan ID-nya ke 'target_task_id' dan pilih action 'DELETE_TASK'.
3. Jika user ingin membuat tugas atau jadwal baru, pilih action 'CREATE_TASKS'.
4. Hitung tanggal & jam relatif ('besok', 'nanti malam jam 8', 'selasa jam 13', 'pagi jam 7') secara akurat berdasarkan WAKTU SEKARANG dan TIMEZONE user.
5. "workspace" / "category" pilih salah satu: "General" | "Engineering" | "Design" | "Personal".
6. "priority" pilih salah satu: "Low" | "Medium" | "High".
7. "scheduled_at" / "due_date" harus berupa ISO-8601 string yang valid dengan offset lokal timezone (contoh: 2026-08-16T15:00:00+07:00).
8. "confirmation_reply" adalah balasan suara ramah, ringkas, dan natural khas Partner (contoh: "Siap bro, tugas laporan keuangan udah ditandai selesai!").
9. "is_ambiguous": Set true jika perintah user kurang jelas atau ambigu.

Return STRICT JSON matching this schema:
{
  "action": "CREATE_TASKS" | "COMPLETE_TASK" | "DELETE_TASK" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "target_task_id": "ID task dari DAFTAR TUGAS AKTIF jika COMPLETE_TASK atau DELETE_TASK, selain itu null",
  "title": "Judul ringkas tugas utama",
  "workspace": "General" | "Engineering" | "Design" | "Personal",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "priority": "Low" | "Medium" | "High",
  "scheduled_at": "ISO-8601 string or null",
  "due_date": "ISO-8601 string or null",
  "duration_minutes": 30,
  "is_ambiguous": false,
  "confirmation_reply": "Balasan singkat dan natural khas Partner",
  "reply_summary": "Balasan singkat dan natural khas Partner",
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
