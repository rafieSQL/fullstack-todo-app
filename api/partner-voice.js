export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  )

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    let body = req.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        // keep as is
      }
    }
    const { audioBase64, currentTimeISO } = body || {}
    const apiKey = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY

    if (!apiKey) {
      return res
        .status(500)
        .json({ error: 'GROQ_API_KEY is not set on Vercel Environment Variables' })
    }

    if (!audioBase64) {
      return res.status(400).json({ error: 'No audio data received' })
    }

    // Convert Base64 back to Blob/Buffer for Groq Whisper
    const audioBuffer = Buffer.from(audioBase64, 'base64')
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2)

    // Construct manual multipart payload for Whisper
    const preBuffer = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\nid\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
        `Content-Type: audio/webm\r\n\r\n`
    )
    const postBuffer = Buffer.from(`\r\n--${boundary}--\r\n`)
    const fullBody = Buffer.concat([preBuffer, audioBuffer, postBuffer])

    // 1. Whisper Transcription
    const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: fullBody
    })

    if (!whisperRes.ok) {
      const errText = await whisperRes.text()
      return res.status(whisperRes.status).json({ error: `Groq Whisper Error: ${errText}` })
    }

    const whisperData = await whisperRes.json()
    const transcript = (whisperData.text || '').trim()

    if (!transcript) {
      return res.status(200).json({
        transcript: '',
        result: {
          action: 'UNKNOWN',
          title: '',
          reply_summary: 'Suara tidak terdeteksi. Silakan coba lagi.'
        }
      })
    }

    // 2. Llama 3 Intent Reasoning
    const llamaRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are an elite productivity AI. Parse user commands (Indonesian/English). Reference time: ${currentTimeISO}.
Return ONLY valid JSON matching this schema without markdown:
{
  "action": "CREATE_TASK" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "title": "Clean concise title",
  "start_time": "ISO-8601 string or null",
  "end_time": "ISO-8601 string or null",
  "priority": "High" | "Medium" | "Low",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "target_view": "calendar" | "tasks" | "focus" | null,
  "reply_summary": "Friendly Indonesian acknowledgment"
}`
          },
          { role: 'user', content: transcript }
        ],
        temperature: 0.1
      })
    })

    if (!llamaRes.ok) {
      const errText = await llamaRes.text()
      return res.status(llamaRes.status).json({ error: `Groq Llama Error: ${errText}` })
    }

    const llamaData = await llamaRes.json()
    const content = (llamaData.choices?.[0]?.message?.content || '{}')
      .replace(/```(?:json)?|```/g, '')
      .trim()
    let result
    try {
      result = JSON.parse(content)
    } catch {
      const match = content.match(/\{[\s\S]*\}/)
      result = match ? JSON.parse(match[0]) : { action: 'UNKNOWN', reply_summary: content }
    }

    return res.status(200).json({ transcript, result })
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Internal Server Error' })
  }
}
