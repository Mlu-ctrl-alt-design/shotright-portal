import middleware, { backendUrl, config } from '../../middleware.js'

describe('backend routing middleware', () => {
  const original = process.env.SHOTRIGHT_BACKEND_ORIGIN
  afterEach(() => {
    if (original === undefined) delete process.env.SHOTRIGHT_BACKEND_ORIGIN
    else process.env.SHOTRIGHT_BACKEND_ORIGIN = original
  })

  it('steps aside when no backend is configured, so vercel.json sends production traffic to production', () => {
    delete process.env.SHOTRIGHT_BACKEND_ORIGIN
    const response = middleware(new Request('https://portal.example/api/method/shotright.api.login'))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('proxies to the configured backend, keeping the path and query string', () => {
    process.env.SHOTRIGHT_BACKEND_ORIGIN = 'https://shotright-staging.thedaystar.co.za'
    const response = middleware(
      new Request('https://portal.example/api/method/shotright.api.get_my_venues?limit=5'),
    )
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://shotright-staging.thedaystar.co.za/api/method/shotright.api.get_my_venues?limit=5',
    )
  })

  it('ignores any path on the configured origin rather than doubling it up', () => {
    expect(String(backendUrl('https://portal.example/files/a.jpg', 'https://bench.example/ignored/'))).toBe(
      'https://bench.example/files/a.jpg',
    )
  })

  it('covers exactly the paths vercel.json proxies', async () => {
    const vercel = (await import('../../vercel.json', { with: { type: 'json' } })).default
    const proxied = vercel.rewrites
      .filter((r) => r.destination.startsWith('https://'))
      .map((r) => r.source)
    expect(config.matcher.sort()).toEqual(proxied.sort())
  })
})
