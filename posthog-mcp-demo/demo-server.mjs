#!/usr/bin/env node
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(__dirname, '../services/mcp/package.json'))
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')

const PORT = 9292
const TOKEN = process.env.POSTHOG_MCP_TOKEN ?? 'phx_demo_dummy_token_not_real'
const MCP_BASE = process.env.POSTHOG_MCP_URL ?? 'http://127.0.0.1:8787/mcp'

const VARIANT_URLS = {
    default: MCP_BASE,
    'resources-none': `${MCP_BASE}${MCP_BASE.includes('?') ? '&' : '?'}resources=none`,
    'mode-tools': `${MCP_BASE}${MCP_BASE.includes('?') ? '&' : '?'}mode=tools`,
}

function schemeBucket(uri) {
    const m = uri.match(/^([a-z-]+:\/\/[^/]+)/i)
    return m ? `${m[1]}/*` : uri
}

export async function fetchMcpSnapshot(url) {
    const client = new Client({ name: 'resources-flood-demo', version: '1.0.0' })
    await client.connect(
        new StreamableHTTPClientTransport(new URL(url), {
            requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
        })
    )

    async function all(method, key) {
        const out = []
        let cursor
        do {
            const r = await client[method](cursor ? { cursor } : {})
            out.push(...r[key])
            cursor = r.nextCursor
        } while (cursor)
        return out
    }

    const tools = await all('listTools', 'tools')
    const resources = client.getServerCapabilities()?.resources ? await all('listResources', 'resources') : []

    const breakdownByScheme = {}
    for (const r of resources) {
        const k = schemeBucket(r.uri)
        breakdownByScheme[k] = (breakdownByScheme[k] ?? 0) + 1
    }

    const first20Resources = resources.slice(0, 20).map((r) => ({
        name: r.title ?? r.name ?? r.uri,
        uri: r.uri,
    }))

    await client.close()

    return {
        url,
        toolCount: tools.length,
        resourceCount: resources.length,
        breakdownByScheme,
        first20Resources,
    }
}

const indexHtml = readFileSync(join(__dirname, 'index.html'), 'utf8')

const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

    if (req.method === 'GET' && u.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(indexHtml)
        return
    }

    if (req.method === 'GET' && u.pathname === '/api/snapshot') {
        const variant = u.searchParams.get('variant') ?? 'default'
        const url = VARIANT_URLS[variant] ?? VARIANT_URLS.default
        try {
            const body = await fetchMcpSnapshot(url)
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(body, null, 2))
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            res.writeHead(502, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: message, url, variant }, null, 2))
        }
        return
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('Not found')
})

server.listen(PORT, '127.0.0.1', () => {
    console.log(`PostHog MCP resources flood demo: http://127.0.0.1:${PORT}/`)
    console.log(`Expect MCP at ${MCP_BASE} (fake API :8010 if using offline stub)`)
})
