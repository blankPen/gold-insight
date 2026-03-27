import { FastifyInstance } from 'fastify'
import { priceEmitter } from './scraper'

type PricePayload = any

class SSEManager {
  private clients: Map<string, { res: any; heartbeat: NodeJS.Timeout }>
  public maxConnections: number

  constructor(maxConnections = 50) {
    this.clients = new Map()
    this.maxConnections = maxConnections
  }

  addClient(res: any, clientId: string) {
    if (this.clients.size >= this.maxConnections) {
      try {
        res.writeHead(503, { 'Content-Type': 'text/plain' })
        res.end('Service Unavailable: too many connections')
      } catch {
        // ignore
      }
      return
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    // Initial connection message
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`)

    // Heartbeat every 30 seconds
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n')
    }, 30000)

    // Track client
    this.clients.set(clientId, { res, heartbeat })

    // Cleanup on socket close
    res.socket?.on('close', () => {
      this.removeClient(clientId)
    })
  }

  removeClient(clientId: string) {
    const entry = this.clients.get(clientId)
    if (!entry) return
    clearInterval(entry.heartbeat)
    try {
      entry.res.end()
    } catch {
      // ignore
    }
    this.clients.delete(clientId)
  }

  broadcastPrice(priceData: PricePayload) {
    const payload = typeof priceData === 'string' ? priceData : JSON.stringify(priceData)
    for (const [, client] of this.clients) {
      try {
        client.res.write(`event: price\ndata: ${payload}\n\n`)
      } catch {
        // ignore failures for individual clients
      }
    }
  }

  cleanup() {
    for (const clientId of Array.from(this.clients.keys())) {
      this.removeClient(clientId)
    }
  }
}

// Singleton instance to be shared by the app
export const sseManager = new SSEManager()

function registerSSE(app: FastifyInstance) {
  // Subscribe to price events from scraper
  try {
    priceEmitter.on('price', (data: PricePayload) => {
      sseManager.broadcastPrice(data)
    })
  } catch {
    // If priceEmitter is not yet available, skip early subscription
  }

  app.get('/events', (_req: any, reply: any) => {
    const res = (reply as any).raw ?? (reply as any).res ?? reply
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    sseManager.addClient(res, clientId)
  })

  return sseManager
}

export { registerSSE }
