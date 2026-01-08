/**
 * Fstab file parsing utilities
 */

import type { FstabEntry } from '@ecmaos/types'

/**
 * Parse a single fstab line
 * @param line - The line to parse
 * @returns Parsed entry or null if line is empty/comment
 */
export function parseFstabLine(line: string): Omit<FstabEntry, 'source'> & { source?: string } | null {
  const trimmed = line.trim()
  
  // Skip empty lines and comments
  if (trimmed === '' || trimmed.startsWith('#')) {
    return null
  }

  // Split by whitespace (space or tab)
  // Format: source target type [options]
  const parts = trimmed.split(/\s+/)
  
  if (parts.length < 3) {
    // Need at least source, target, and type
    return null
  }

  const source = parts[0] || ''
  const target = parts[1] || ''
  const type = parts[2] || ''
  const options = parts.slice(3).join(' ') || undefined

  // Validate required fields
  if (!target || !type) {
    return null
  }

  return {
    source: source || undefined,
    target,
    type,
    options
  }
}

/**
 * Parse a complete fstab file
 * @param content - The fstab file content
 * @returns Array of parsed fstab entries
 */
export function parseFstabFile(content: string): FstabEntry[] {
  const lines = content.split('\n')
  const entries: FstabEntry[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const parsed = parseFstabLine(line)
    
    if (parsed) {
      entries.push({
        source: parsed.source || '',
        target: parsed.target,
        type: parsed.type,
        options: parsed.options
      })
    }
  }

  return entries
}
