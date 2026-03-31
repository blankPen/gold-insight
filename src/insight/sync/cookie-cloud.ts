/**
 * Sync 模块：CookieCloud 解密与 CME Cookie
 */
import * as crypto from 'crypto'
import axios from 'axios'
import { getConfig } from './config'

export function decryptCookieCloud(encrypted: string, keyPassword: string): Record<string, unknown> {
  const raw = Buffer.from(encrypted, 'base64')

  // OpenSSL 格式: "Salted__" + 8字节salt + 密文
  const saltHeader = raw.slice(0, 8).toString()
  if (saltHeader !== 'Salted__') {
    throw new Error(`Invalid CookieCloud encrypted format: expected "Salted__", got "${saltHeader}"`)
  }

  const salt = raw.slice(8, 16)
  const ciphertext = raw.slice(16)

  // EVP_BytesToKey: MD5 迭代派生 key(32字节) + iv(16字节)
  const password = Buffer.from(keyPassword, 'utf8')
  let hash = Buffer.alloc(0)
  let result = Buffer.alloc(0)
  const needed = 32 + 16 // AES-256-CBC

  while (result.length < needed) {
    const input = Buffer.concat([hash, password, salt])
    hash = crypto.createHash('md5').update(input).digest()
    result = Buffer.concat([result, hash])
  }

  const key = result.slice(0, 32)
  const iv = result.slice(32, 48)

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  let decrypted = decipher.update(ciphertext)
  decrypted = Buffer.concat([decrypted, decipher.final()])

  return JSON.parse(decrypted.toString('utf8'))
}

// ============================================================================
// Cookie 获取
// ============================================================================

/**
 * 从 CookieCloud 获取 CME 的 cookie
 */
export async function fetchCMECookies(): Promise<unknown[]> {
  const { COOKIE_CLOUD } = getConfig()
  const url = `${COOKIE_CLOUD.host}/get/${COOKIE_CLOUD.uuid}`

  // console.log(`[CookieCloud] Fetching from: ${COOKIE_CLOUD.host}`)

  const response = await axios.get(url)
  const data = response.data

  // 解密 key = MD5(uuid + '-' + password) 取前16字符
  const keyPassword = crypto
    .createHash('md5')
    .update(`${COOKIE_CLOUD.uuid}-${COOKIE_CLOUD.password}`)
    .digest('hex')
    .substring(0, 16)

  const decrypted = decryptCookieCloud(data.encrypted as string, keyPassword)

  // 提取 cmegroup.com 的 cookie
  const cookieData = (decrypted.cookie_data || decrypted) as Record<string, unknown[]>
  let cmeCookies: unknown[] = []

  for (const domain in cookieData) {
    if (domain.includes('cmegroup.com')) {
      cmeCookies = cmeCookies.concat(cookieData[domain])
    }
  }

  console.log(`[CookieCloud] Got ${cmeCookies.length} CME cookies`)
  // // 缓存到本地
  // const { COOKIE_CACHE_FILE } = getConfig()
  // const cacheDir = path.dirname(COOKIE_CACHE_FILE)
  // if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true })
  // fs.writeFileSync(COOKIE_CACHE_FILE, JSON.stringify(cmeCookies, null, 2))

  return cmeCookies
}
