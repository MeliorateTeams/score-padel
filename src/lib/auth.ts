// Allowed email domains for registration and admin user management
export const ALLOWED_EMAIL_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'outlook.es',
  'hotmail.com',
  'hotmail.es',
  'yahoo.com',
  'yahoo.es',
  'icloud.com',
  'live.com',
]

export function isAllowedEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return !!domain && ALLOWED_EMAIL_DOMAINS.includes(domain)
}

const VERIFICATION_CODE_DIGITS = 6

// Password hashing using Web Crypto API (PBKDF2) - works in Cloudflare Workers
const ITERATIONS = 100000
const SALT_LENGTH = 16
const KEY_LENGTH = 32

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const key = await deriveKey(password, salt)
  const hash = await crypto.subtle.exportKey('raw', key)
  const hashArray = new Uint8Array(hash)
  return `${toHex(salt)}:${toHex(hashArray)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const salt = fromHex(saltHex)
  const key = await deriveKey(password, salt)
  const hash = await crypto.subtle.exportKey('raw', key)
  // Constant-time comparison to prevent timing attacks
  const a = new Uint8Array(hash)
  const b = fromHex(hashHex)
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

export async function hashVerificationCode(code: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${saltHex}:${code}`))
  return toHex(new Uint8Array(digest))
}

export function generateVerificationCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 10 ** VERIFICATION_CODE_DIGITS
  return value.toString().padStart(VERIFICATION_CODE_DIGITS, '0')
}

export function generateVerificationSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)))
}

export function timingSafeEqualText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH * 8 },
    true,
    ['encrypt'],
  )
}

function toHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return arr
}

export function generateId(): string {
  return crypto.randomUUID()
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return toHex(bytes)
}
