#!/usr/bin/env node

const { createServer } = require('http')
const { parse } = require('url')
const { readdir, stat, readFile } = require('fs').promises
const { createHash } = require('crypto')
const path = require('path')

const servePath = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
const ignorePatterns = ['node_modules', '.git'].map(p => new RegExp(p.replace(/\*/g, '.*')))

let cache = null
let cacheMtime = null

function fixSlash(filePath) {
  return filePath.replaceAll('\\', '/')
}

function shouldIgnore(filePath) {
  const relPath = path.relative(servePath, filePath)
  return ignorePatterns.some(pattern => pattern.test(relPath))
}

async function computeEntries(filePath, entries) {
  if (shouldIgnore(filePath)) {
    return
  }

  const stats = await stat(filePath)
  let relPath = path.relative(servePath, filePath)
  relPath = relPath === '' ? '/' : '/' + fixSlash(relPath)
  
  entries.set(relPath, stats)

  if (stats.isDirectory()) {
    const files = await readdir(filePath)
    for (const file of files) {
      await computeEntries(path.join(filePath, file), entries)
    }
  }
}

async function generateIndex() {
  const entries = new Map()
  await computeEntries(servePath, entries)
  
  const output = {
    version: 1,
    entries: Object.fromEntries(entries)
  }
  
  const json = JSON.stringify(output)
  const etag = createHash('md5').update(json).digest('hex')
  
  return { json, etag }
}

const server = createServer(async (req, res) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*'
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders)
    res.end()
    return
  }

  try {
    const { pathname, query } = parse(req.url, true)
    const forceRefresh = query && query.refresh === 'true'
    
    if (pathname === '/index.json') {
      const rootStats = await stat(servePath)
      const ifNoneMatch = req.headers['if-none-match']
      
      if (!forceRefresh && cache && cacheMtime && rootStats.mtimeMs <= cacheMtime) {
        if (ifNoneMatch === cache.etag) {
          res.writeHead(304, { ...corsHeaders, 'ETag': cache.etag })
          res.end()
          return
        }
        
        res.writeHead(200, {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'ETag': cache.etag,
          'Cache-Control': 'public, max-age=3600'
        })
        res.end(cache.json)
        return
      }
      
      const { json, etag } = await generateIndex()
      cache = { json, etag }
      cacheMtime = rootStats.mtimeMs
      
      if (ifNoneMatch === etag) {
        res.writeHead(304, { ...corsHeaders, 'ETag': etag })
        res.end()
        return
      }
      
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'ETag': etag,
        'Cache-Control': 'public, max-age=3600'
      })
      res.end(json)
    } else {
      const filePath = path.join(servePath, pathname)
      const stats = await stat(filePath)
      if (stats.isFile()) {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/octet-stream' })
        res.end(await readFile(filePath))
      } else {
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'text/plain' })
        res.end('Not found')
      }
    }
  } catch (err) {
    res.writeHead(500, { ...corsHeaders, 'Content-Type': 'text/plain' })
    res.end(`Server error: ${err.message}`)
  }
})

const port = Number(process.env.PORT) || 30808
server.listen(port, () => {
  console.log(`Serving directory ${servePath} on http://localhost:${port}/`)
})
