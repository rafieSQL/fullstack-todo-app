/**
 * Input sanitization and validation utilities to neutralize XSS
 * and enforce strict data boundaries across the application.
 */

// Regex matching unprintable ASCII control characters (excluding newline \n and tab \t if needed)
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

/**
 * Sanitize generic string input:
 * 1. Strips dangerous unprintable control characters
 * 2. Normalizes multiple contiguous whitespaces into single spaces
 * 3. Trims whitespace
 * 4. Enforces max character length limit
 *
 * @param {string} input - Raw input string
 * @param {number} [maxLength=250] - Maximum allowed character length
 * @returns {string} - Cleaned, sanitized string
 */
export function sanitizeText(input, maxLength = 250) {
  if (typeof input !== 'string') return ''

  return input
    .replace(CONTROL_CHARS_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/**
 * Validate and sanitize task titles before submission
 *
 * @param {string} title - Raw title
 * @returns {{ isValid: boolean, sanitized: string, error: string | null }}
 */
export function validateTaskTitle(title) {
  const sanitized = sanitizeText(title, 250)

  if (!sanitized || sanitized.length === 0) {
    return {
      isValid: false,
      sanitized: '',
      error: 'Task title cannot be empty or contain only whitespace.'
    }
  }

  if (sanitized.length > 250) {
    return {
      isValid: false,
      sanitized: sanitized.slice(0, 250),
      error: 'Task title cannot exceed 250 characters.'
    }
  }

  return {
    isValid: true,
    sanitized,
    error: null
  }
}

/**
 * Sanitize and validate email address
 *
 * @param {string} email
 * @returns {string}
 */
export function sanitizeEmail(email) {
  if (typeof email !== 'string') return ''
  return email
    .replace(CONTROL_CHARS_REGEX, '')
    .trim()
    .toLowerCase()
    .slice(0, 100)
}
