/**
 * Cloudflare Pages middleware — only allow requests from the artisebio-web proxy.
 * Direct access to the subdomain (without the proxy secret) returns 403.
 */
export async function onRequest({ request, env, next }) {
  const secret = env.PROXY_SECRET;
  if (secret && request.headers.get('x-proxy-secret') !== secret) {
    return new Response('Access denied', { status: 403 });
  }
  return next();
}
