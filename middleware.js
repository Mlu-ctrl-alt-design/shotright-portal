import { next, rewrite } from '@vercel/functions/middleware'

/**
 * Picks which Frappe bench this deployment talks to.
 *
 * `vercel.json` proxies /api, /files and /private to production, and a rewrite
 * there cannot read an environment variable. So without this, EVERY deployment
 * — previews and the staging branch included — sent partners' clicks to the live
 * bench.
 *
 * Set `SHOTRIGHT_BACKEND_ORIGIN` (Vercel → Settings → Environment Variables) to
 * send this deployment somewhere else, e.g. `https://shotright-staging.thedaystar.co.za`
 * for Preview. Leave it UNSET for Production: the middleware then steps aside
 * and the `vercel.json` rewrites apply exactly as before, so a missing or broken
 * variable can only ever fall back to production behaviour, never break it.
 */
export const config = {
  matcher: ['/api/:path*', '/files/:path*', '/private/:path*'],
}

export function backendUrl(requestUrl, origin) {
  if (!origin) return null
  const { pathname, search } = new URL(requestUrl)
  return new URL(pathname + search, origin)
}

export default function middleware(request) {
  const target = backendUrl(request.url, process.env.SHOTRIGHT_BACKEND_ORIGIN)
  return target ? rewrite(target) : next()
}
