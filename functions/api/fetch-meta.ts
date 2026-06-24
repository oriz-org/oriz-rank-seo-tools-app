/**
 * CF Pages Function: /api/fetch-meta
 * Fetches a URL server-side and returns meta tags as JSON (avoids CORS).
 *
 * Query params:
 *   url = the URL to fetch
 *
 * Returns JSON: { title, description, ogTitle, ogDescription, ogImage, ogType, ogUrl,
 *                 twitterCard, twitterTitle, twitterDescription, twitterImage, canonical, error? }
 */

export const onRequestGet: PagesFunction = async ({ request }) => {
  const { searchParams } = new URL(request.url)
  const target = searchParams.get('url')

  if (!target) {
    return Response.json({ error: 'Missing url parameter' }, { status: 400 })
  }

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return Response.json({ error: 'Only http/https URLs allowed' }, { status: 400 })
    }
  } catch {
    return Response.json({ error: 'Invalid URL' }, { status: 400 })
  }

  try {
    const res = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'OrizSEOBot/1.0 (+https://seo.oriz.in)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
      // CF Workers timeout is ~30s; stay well within
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      return Response.json(
        { error: `Upstream returned ${res.status} ${res.statusText}` },
        { status: 502 }
      )
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('html')) {
      return Response.json(
        { error: `Expected HTML, got: ${contentType}` },
        { status: 422 }
      )
    }

    const html = await res.text()

    // Lightweight regex parser — no DOM available in CF Workers
    const get = (regex: RegExp): string =>
      (regex.exec(html)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()

    const meta: Record<string, string> = {}

    // title
    meta.title = get(/<title[^>]*>([^<]*)<\/title>/i)

    // standard meta
    for (const m of html.matchAll(/<meta\s[^>]+>/gi)) {
      const tag = m[0]
      const name = (/name=["']([^"']*)["']/i.exec(tag)?.[1] ?? '').toLowerCase()
      const prop = (/property=["']([^"']*)["']/i.exec(tag)?.[1] ?? '').toLowerCase()
      const content = /content=["']([^"']*)["']/i.exec(tag)?.[1] ?? ''
      const decoded = content.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()

      if (name === 'description') meta.description = decoded
      if (prop === 'og:title') meta.ogTitle = decoded
      if (prop === 'og:description') meta.ogDescription = decoded
      if (prop === 'og:image') meta.ogImage = decoded
      if (prop === 'og:type') meta.ogType = decoded
      if (prop === 'og:url') meta.ogUrl = decoded
      if (name === 'twitter:card') meta.twitterCard = decoded
      if (name === 'twitter:title') meta.twitterTitle = decoded
      if (name === 'twitter:description') meta.twitterDescription = decoded
      if (name === 'twitter:image') meta.twitterImage = decoded
    }

    // canonical
    const canonicalMatch = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*/i.exec(html)
      ?? /<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["'][^>]*/i.exec(html)
    meta.canonical = canonicalMatch?.[1]?.trim() ?? ''

    // Resolve relative og:image against the target URL
    if (meta.ogImage && !meta.ogImage.startsWith('http')) {
      try {
        meta.ogImage = new URL(meta.ogImage, targetUrl.origin).toString()
      } catch { /* leave as-is */ }
    }
    if (meta.twitterImage && !meta.twitterImage.startsWith('http')) {
      try {
        meta.twitterImage = new URL(meta.twitterImage, targetUrl.origin).toString()
      } catch { /* leave as-is */ }
    }

    return Response.json(meta, {
      headers: {
        'Access-Control-Allow-Origin': 'https://seo.oriz.in',
        'Cache-Control': 'public, max-age=300',
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `Fetch failed: ${msg}` }, { status: 502 })
  }
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': 'https://seo.oriz.in',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
