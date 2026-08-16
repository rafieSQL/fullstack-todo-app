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

    const { transcript, clientTime, timezone } = body || {};

    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const cleanTranscript = transcript.trim();
    const userTimezone = timezone || 'Asia/Jakarta';
    const refTime = clientTime || new Date().toISOString();

    const geminiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY;

    const systemInstruction = `Kamu adalah AI Partner di Task Registry & Calendar.
WAKTU SEKARANG (User): ${refTime}
TIMEZONE: ${userTimezone}

Tugasmu:
1. Ekstrak perintah user (Bahasa Indonesia / Inggris) menjadi data task terstruktur.
2. Hitung tanggal & jam relatif ('besok', 'nanti malam jam 8', 'selasa jam 13', 'pagi jam 7') secara akurat berdasarkan WAKTU SEKARANG dan TIMEZONE user.
3. Dukung dekomposisi kalimat multi-tugas jika user menyebutkan lebih dari 1 tugas/jadwal ke dalam array "tasks".
4. "workspace" / "category" pilih salah satu: "General" | "Engineering" | "Design" | "Personal".
5. "priority" pilih salah satu: "Low" | "Medium" | "High".
6. "scheduled_at" / "due_date" harus berupa ISO-8601 string yang valid dengan offset lokal timezone atau UTC (contoh: 2026-08-16T15:00:00+07:00).
7. "confirmation_reply" adalah balasan suara ramah, ringkas, dan natural khas Partner (contoh: "Siap bro, tugas siapkan laporan jam 3 sore udah masuk kalender.").

Return STRICT JSON matching this schema:
{
  "action": "CREATE_TASKS" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "title": "Judul ringkas tugas utama",
  "workspace": "General" | "Engineering" | "Design" | "Personal",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "priority": "Low" | "Medium" | "High",
  "scheduled_at": "ISO-8601 string or null",
  "due_date": "ISO-8601 string or null",
  "duration_minutes": 30,
  "confirmation_reply": "Balasan singkat dan natural",
  "reply_summary": "Balasan singkat dan natural",
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
