/**
 * Crontab file parsing utilities
 */

import { parseCronExpression } from 'cron-schedule'

export interface CrontabEntry {
  expression: string
  command: string
  lineNumber: number
}

/**
 * Parse a single crontab line
 * @param line - The line to parse
 * @returns Parsed entry or null if line is empty/comment
 */
export function parseCrontabLine(line: string): { expression: string, command: string } | null {
  const trimmed = line.trim()
  
  // Skip empty lines and comments
  if (trimmed === '' || trimmed.startsWith('#')) {
    return null
  }

  // Split by whitespace - cron expression is first 5 or 6 fields
  const parts = trimmed.split(/\s+/)
  
  if (parts.length < 6) {
    // Need at least 5 fields for cron expression + command
    return null
  }

  // Check if first field is a number (seconds field) or cron expression starts
  // Standard format: minute hour day month weekday command
  // Extended format: second minute hour day month weekday command
  let expression: string
  let command: string

  // Try 6-field format first (with seconds)
  if (parts.length >= 7) {
    // Check if first part looks like seconds (0-59 or */N or range)
    const firstPart = parts[0]
    if (!firstPart) return null
    const isSecondsField = /^(\*|\d+(-\d+)?|\*\/\d+|\d+(-\d+)?\/\d+)$/.test(firstPart)
    
    if (isSecondsField) {
      // 6-field format: second minute hour day month weekday command
      expression = parts.slice(0, 6).join(' ')
      command = parts.slice(6).join(' ')
    } else {
      // 5-field format: minute hour day month weekday command
      expression = parts.slice(0, 5).join(' ')
      command = parts.slice(5).join(' ')
    }
  } else {
    // 5-field format: minute hour day month weekday command
    expression = parts.slice(0, 5).join(' ')
    command = parts.slice(5).join(' ')
  }

  // Validate the expression
  try {
    parseCronExpression(expression)
  } catch {
    return null
  }

  return { expression, command }
}

/**
 * Parse a complete crontab file
 * @param content - The crontab file content
 * @returns Array of parsed crontab entries
 */
export function parseCrontabFile(content: string): CrontabEntry[] {
  const lines = content.split('\n')
  const entries: CrontabEntry[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const parsed = parseCrontabLine(line)
    
    if (parsed) {
      entries.push({
        expression: parsed.expression,
        command: parsed.command,
        lineNumber: i + 1
      })
    }
  }

  return entries
}
