/**
 * Cloudflare Pages middleware — block direct access.
 * Only requests forwarded by the artisebio-web proxy (x-proxy-secret) are allowed.
 */
export async function onRequest({ request, env, next }) {
  const secret = env.PROXY_SECRET;
  if (secret && request.headers.get("x-proxy-secret") !== secret) {
    return new Response("Access denied", { status: 403 });
  }
  return next();
}
