import { parseVoiceIntent } from './voiceCommandEngine.js'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const PRIMARY_MODEL = 'llama-3.3-70b-versatile'
const FALLBACK_MODEL = 'llama-3.1-8b-instant'

function capitalizeFirstLetter(str) {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

/**
 * Extract clean JSON object from LLM response (handling potential markdown formatting)
 */
function extractJSON(text) {
  if (!text) return null
  const cleaned = text.trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const matchJsonBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (matchJsonBlock && matchJsonBlock[1]) {
      try {
        return JSON.parse(matchJsonBlock[1].trim())
      } catch {
        // continue
      }
    }
    const matchObject = cleaned.match(/\{[\s\S]*\}/)
    if (matchObject) {
      try {
        return JSON.parse(matchObject[0])
      } catch {
        // continue
      }
    }
    return null
  }
}

function fallbackToLocal(transcript) {
  const local = parseVoiceIntent(transcript)
  let action = 'UNKNOWN'
  let replySummary = `Perintah: "${transcript}"`
  let targetView = null

  if (local.type === 'ADD_TASK') {
    action = 'CREATE_TASK'
    replySummary = `Tugas "${local.title}" berhasil dibuat.`
  } else if (local.type === 'SCHEDULE_TASK') {
    action = 'SCHEDULE_EVENT'
    replySummary = `Jadwal "${local.title}" berhasil diatur.`
  } else if (local.type === 'NAVIGATE') {
    action = 'NAVIGATE'
    targetView = local.view
    replySummary = `Beralih ke ${
      local.view === 'calendar' ? 'Kalender' : local.view === 'focus' ? 'Fokus' : 'Tugas'
    }.`
  } else if (local.type === 'CLEAR_COMPLETED') {
    action = 'CLEAR_COMPLETED'
    replySummary = 'Membersihkan tugas yang telah selesai.'
  }

  return {
    action,
    title: local.title || transcript,
    start_time: local.startTime || null,
    end_time: local.endTime || null,
    priority: local.priority ? capitalizeFirstLetter(local.priority) : 'Medium',
    category: local.category || 'General',
    target_view: targetView,
    reply_summary: replySummary,
    raw: transcript
  }
}

function sanitizeAIResult(result, rawTranscript) {
  let action = result.action || 'UNKNOWN'
  if (action === 'ADD_TASK') action = 'CREATE_TASK'
  if (action === 'SCHEDULE_TASK') action = 'SCHEDULE_EVENT'

  let targetView = result.target_view
  if (action === 'NAVIGATE' && !targetView) {
    const lower = (rawTranscript || '').toLowerCase()
    if (lower.includes('kalender') || lower.includes('calendar') || lower.includes('jadwal')) {
      targetView = 'calendar'
    } else if (lower.includes('focus') || lower.includes('fokus')) {
      targetView = 'focus'
    } else {
      targetView = 'tasks'
    }
  }

  return {
    action,
    title: result.title ? result.title.trim() : '',
    start_time: result.start_time || null,
    end_time: result.end_time || null,
    priority: result.priority ? capitalizeFirstLetter(result.priority) : 'Medium',
    category: result.category ? capitalizeFirstLetter(result.category) : 'General',
    target_view: targetView || null,
    reply_summary:
      result.reply_summary || `Perintah diproses: "${result.title || rawTranscript}"`,
    raw: rawTranscript
  }
}

/**
 * Parse user voice or text command into structured intent using Groq Llama 3
 */
export async function parseCommandWithAI(transcript, currentTimeISO = new Date().toISOString()) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY

  if (!apiKey || apiKey.trim() === '') {
    console.warn('VITE_GROQ_API_KEY is not configured. Using local intent parser.')
    return fallbackToLocal(transcript)
  }

  const systemPrompt = `You are an intelligent task & calendar assistant for a productivity application. Parse user commands (in Indonesian or English) and extract structured intent.
Current reference ISO time: ${currentTimeISO}.

Return STRICT JSON ONLY matching this schema without markdown blocks:
{
  "action": "CREATE_TASK" | "SCHEDULE_EVENT" | "NAVIGATE" | "CLEAR_COMPLETED" | "UNKNOWN",
  "title": "Clean, concise task or event title (omit command words like 'tambah' or 'add')",
  "start_time": "ISO-8601 string or null",
  "end_time": "ISO-8601 string or null",
  "priority": "High" | "Medium" | "Low",
  "category": "General" | "Engineering" | "Design" | "Personal",
  "target_view": "calendar" | "tasks" | "focus" | null,
  "reply_summary": "Friendly Indonesian acknowledgment (e.g. 'Tugas [judul] berhasil ditambahkan', 'Jadwal [judul] diatur pukul [jam]', etc.)"
}`

  const userPrompt = `User Command: "${transcript}"`

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: PRIMARY_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      console.warn(
        `Groq primary model failed (${response.status}). Trying fallback model ${FALLBACK_MODEL}...`
      )
      const fallbackResp = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model: FALLBACK_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      })

      if (!fallbackResp.ok) {
        throw new Error(
          `Groq API request failed (${fallbackResp.status}): ${fallbackResp.statusText}`
        )
      }

      const fbData = await fallbackResp.json()
      const content = fbData.choices?.[0]?.message?.content
      const parsed = extractJSON(content)
      if (parsed) return sanitizeAIResult(parsed, transcript)
    } else {
      const data = await response.json()
      const content = data.choices?.[0]?.message?.content
      const parsed = extractJSON(content)
      if (parsed) return sanitizeAIResult(parsed, transcript)
    }

    throw new Error('Could not parse valid JSON from Groq AI response.')
  } catch (err) {
    console.error('Groq AI parseCommand error:', err)
    return fallbackToLocal(transcript)
  }
}
