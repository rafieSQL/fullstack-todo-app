/**
 * Resilient fetch with custom AbortController hard timeout (default: 7000ms)
 * Prevents AI API requests from hanging indefinitely.
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    return response
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('TIMEOUT: AI Partner butuh waktu terlalu lama.')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}
