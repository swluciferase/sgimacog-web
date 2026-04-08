async function handleFontRequest(context) {
  const req = context.request;
  let text = '';
  
  if (req.method === 'POST') {
    text = await req.text();
  } else {
    const url = new URL(req.url);
    text = url.searchParams.get('text');
  }

  if (!text) {
    return new Response('Missing text parameter', { status: 400 });
  }

  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&text=${encodeURIComponent(text)}`;
    // Trick Google Fonts into returning TTF instead of WOFF2 by simulating an old client
    const cssRes = await fetch(cssUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1" 
      }
    });
    
    if (!cssRes.ok) {
      return new Response('Failed to fetch font CSS', { status: 502 });
    }
    
    const cssText = await cssRes.text();
    
    // Find all URL matches for TTF (could be multiple if both normal and bold are returned)
    const matches = [...cssText.matchAll(/url\(([^)]+)\)/g)];
    if (matches.length === 0) {
      return new Response('No TTF URLs found in Google Fonts CSS', { status: 502 });
    }
    
    // Pick the first URL
    const ttfUrl = matches[0][1].replace(/['"]/g, '');
    
    const ttfRes = await fetch(ttfUrl);
    if (!ttfRes.ok) {
      return new Response('Failed to fetch TTF bytes', { status: 502 });
    }
    
    // Return the binary data straight back to the client!
    return new Response(ttfRes.body, {
      headers: {
        'Content-Type': 'font/ttf',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response('Internal error: ' + err.message, { status: 500 });
  }
}

export async function onRequestGet(context) { return handleFontRequest(context); }
export async function onRequestPost(context) { return handleFontRequest(context); }
