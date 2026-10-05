// Unc's Journal — Cloudflare Worker
// Routes: / (AI proxy, auth + rate limited), /market-data (Yahoo Finance),
//         /screenshot (CORS proxy), /calendar (ForexFactory)

const SUPABASE_URL = 'https://qfqssedstzdgwkhhlzrn.supabase.co';
// FIXED: this must match the project's CURRENT anon key (the one shipped in app.html).
// The old value was stale after the Supabase key rotation, which made /auth/v1/user
// reject every request with "Invalid API key" → the app saw "Sign in required".
// Prefer an env var if set, else fall back to the known-good public anon key.
const SUPABASE_ANON_KEY_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmcXNzZWRzdHpkZ3draGhsenJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwOTE0OTIsImV4cCI6MjA5NTY2NzQ5Mn0.zsEe1Eh-iGztPIC6btPIsNajpUpxBKnhqDeCibZHWww';
const FREE_AI_LIMIT = 5;
const STRUCTURED_FIELDS = {
  trade_analysis: { strings: ['grade', 'summary', 'psychology', 'pattern', 'verdict'], arrays: ['strengths', 'improvements'] },
  weekly_summary: { strings: ['grade', 'headline', 'narrative', 'psychology', 'pattern'], arrays: ['strengths', 'improvements', 'focus'] },
  monthly_report: { strings: ['grade', 'headline', 'narrative', 'psychology', 'nextMonth'], arrays: ['strengths', 'improvements'] },
};

function parseStructuredResponse(text, purpose) {
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let analysis;
  try { analysis = JSON.parse(clean); } catch { throw new Error('AI returned invalid JSON. No credit was used.'); }
  const fields = STRUCTURED_FIELDS[purpose];
  if (!analysis || Array.isArray(analysis) || typeof analysis !== 'object'
      || fields.strings.some(key => typeof analysis[key] !== 'string' || !analysis[key].trim())
      || fields.arrays.some(key => !Array.isArray(analysis[key]) || !analysis[key].length
        || analysis[key].some(item => typeof item !== 'string' || !item.trim()))) {
    throw new Error('AI returned an incomplete response. No credit was used.');
  }
  return analysis;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_FALLBACK;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── /market-data — Yahoo Finance proxy ──────────────────────────────
    if (url.pathname === '/market-data') {
      const symbol = url.searchParams.get('symbol') || 'NQ=F';
      const interval = url.searchParams.get('interval') || '5m';
      const range = url.searchParams.get('range') || '5d';
      try {
        const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
        const res = await fetch(yfUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          cf: { cacheEverything: true, cacheTtl: 300 },
        });
        if (!res.ok) throw new Error('Yahoo Finance returned ' + res.status);
        const data = await res.json();
        const chart = data?.chart?.result?.[0];
        if (!chart) throw new Error('No chart data returned');
        const timestamps = chart.timestamp || [];
        const quotes = chart.indicators?.quote?.[0] || {};
        const candles = timestamps.map((t, i) => ({
          time: t,
          open: parseFloat((quotes.open?.[i] || 0).toFixed(4)),
          high: parseFloat((quotes.high?.[i] || 0).toFixed(4)),
          low: parseFloat((quotes.low?.[i] || 0).toFixed(4)),
          close: parseFloat((quotes.close?.[i] || 0).toFixed(4)),
          volume: Math.round(quotes.volume?.[i] || 0),
        })).filter(c => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);
        return new Response(JSON.stringify({ candles, symbol, interval }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, candles: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── /screenshot — CORS proxy ─────────────────────────────────────────
    if (url.pathname === '/screenshot') {
      const imgUrl = url.searchParams.get('url');
      if (!imgUrl) return new Response('Missing url', { status: 400, headers: corsHeaders });
      try {
        const imgRes = await fetch(imgUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': imgUrl }, cf: { cacheEverything: true, cacheTtl: 3600 } });
        if (!imgRes.ok) return new Response('Image fetch failed: ' + imgRes.status, { status: 502, headers: corsHeaders });
        const blob = await imgRes.arrayBuffer();
        return new Response(blob, { headers: { ...corsHeaders, 'Content-Type': imgRes.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=3600' } });
      } catch (e) {
        return new Response('Proxy error: ' + e.message, { status: 500, headers: corsHeaders });
      }
    }

    // ── /calendar — ForexFactory proxy (serves last-good on upstream rate-limit) ──
    if (url.pathname === '/calendar') {
      const cache = caches.default;
      const cacheKey = new Request('https://cache.local/ff_calendar_lastgood');
      try {
        const ffRes = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' },
        });
        if (ffRes.ok) {
          const data = await ffRes.json();
          if (Array.isArray(data) && data.length) {
            const resp = new Response(JSON.stringify(data), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' },
            });
            await cache.put(cacheKey, resp.clone());   // remember this good copy
            return resp;
          }
        }
        // upstream blocked/empty — serve the last good copy we saved
        const last = await cache.match(cacheKey);
        if (last) return new Response(last.body, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify([]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e) {
        const last = await cache.match(cacheKey);
        if (last) return new Response(last.body, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify([]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // ── / — Anthropic AI proxy (auth + server-side rate limit) ──────────
    if (request.method === 'POST') {
      // 1. Require a signed-in Supabase user — reject anything without a real token.
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (!token) {
        return new Response(JSON.stringify({ error: { message: 'Sign in required' } }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 2. Verify the token is real and get the user id. Uses the current anon key
      //    as the apikey; works with both HS256 and ES256 (asymmetric) session tokens.
      //    On failure we now surface the real Supabase status/code so a future breakage
      //    is diagnosable instead of a blanket "Sign in required".
      let userId;
      try {
        const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        });
        if (!userRes.ok) {
          const detail = await userRes.text().catch(() => '');
          return new Response(JSON.stringify({ error: { message: 'Sign in required', code: userRes.status, detail: detail.slice(0, 160) } }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const user = await userRes.json();
        userId = user?.id;
        if (!userId) throw new Error('no user id');
      } catch (e) {
        return new Response(JSON.stringify({ error: { message: 'Sign in required', detail: e.message } }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 3. Check their real usage count in Supabase — never trust a client number.
      let currentUsed;
      try {
        const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=ai_used`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        });
        if (!profRes.ok) throw new Error('Profile lookup failed');
        const rows = await profRes.json();
        currentUsed = rows?.[0]?.ai_used;
        if (!Number.isInteger(currentUsed) || currentUsed < 0) throw new Error('Profile usage is unavailable');
      } catch (e) {
        return new Response(JSON.stringify({ error: { message: 'Could not verify AI credits. Please try again.' } }), {
          status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (currentUsed >= FREE_AI_LIMIT) {
        return new Response(JSON.stringify({ error: { message: "You've used all your free AI analyses for now" } }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      try {
        const body = await request.json();
        if (!Array.isArray(body.messages) || !body.messages.length) {
          return new Response(JSON.stringify({ error: { message: 'Messages are required' } }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const purpose = body.purpose || '';
        if (purpose && !STRUCTURED_FIELDS[purpose]) {
          return new Response(JSON.stringify({ error: { message: 'Unsupported AI request type' } }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (purpose === 'trade_analysis' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.trade_id || '')) {
          return new Response(JSON.stringify({ error: { message: 'Save the trade before requesting AI analysis' } }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const apiKey = env.ANTHROPIC_KEY || '';
        const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: body.model || 'claude-haiku-4-5-20251001', max_tokens: body.max_tokens || 1000, system: body.system || '', messages: body.messages || [] }),
        });
        const result = await anthropicRes.json();
        if (!anthropicRes.ok || result?.type === 'error' || !result?.content?.some(item => item.type === 'text' && item.text?.trim())) {
          return new Response(JSON.stringify(anthropicRes.ok ? { error: { message: 'AI returned no usable response' } } : result), {
            status: anthropicRes.ok ? 502 : anthropicRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (purpose) {
          const textBlock = result.content.find(item => item.type === 'text' && item.text?.trim());
          let structured;
          try { structured = parseStructuredResponse(textBlock.text, purpose); }
          catch (error) {
            return new Response(JSON.stringify({ error: { message: error.message } }), {
              status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          // Put validated JSON first, in the form expected by every journal caller.
          result.content = [{ type: 'text', text: JSON.stringify(structured) }];

          if (purpose === 'trade_analysis') {
            const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/save_trade_ai_analysis`, {
              method: 'POST',
              headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ p_trade_id: body.trade_id, p_analysis: structured }),
            });
            if (!saveRes.ok) {
              const detail = await saveRes.json().catch(() => ({}));
              const message = detail.message || 'Could not save the AI analysis. No credit was used.';
              return new Response(JSON.stringify({ error: { message } }), {
                status: /credits remaining/i.test(message) ? 429 : 409,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            }
            const savedUsed = await saveRes.json();
            if (!Number.isInteger(savedUsed)) throw new Error('Could not verify saved AI credit usage');
            result.aiUsed = savedUsed;
            return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }

        // Compare-and-swap prevents concurrent requests from silently overwriting usage.
        // A failed AI call never reaches this point and therefore never uses a credit.
        for (let attempt = 0; attempt < 5; attempt++) {
          const chargeRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&ai_used=eq.${currentUsed}&select=ai_used`, {
            method: 'PATCH',
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              Prefer: 'return=representation',
            },
            body: JSON.stringify({ ai_used: currentUsed + 1 }),
          });
          if (!chargeRes.ok) throw new Error('Could not save AI credit usage');
          const charged = await chargeRes.json();
          if (charged.length === 1) {
            result.aiUsed = charged[0].ai_used;
            return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          const latestRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=ai_used`, {
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
          });
          if (!latestRes.ok) throw new Error('Could not verify AI credit usage');
          const latest = await latestRes.json();
          currentUsed = latest?.[0]?.ai_used;
          if (!Number.isInteger(currentUsed) || currentUsed < 0) throw new Error('Could not verify AI credit usage');
          if (currentUsed >= FREE_AI_LIMIT) break;
        }
        return new Response(JSON.stringify({ error: { message: 'AI credits changed during this request. Please try again.' } }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: { message: e.message } }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    return new Response("Unc's Journal Worker", { headers: corsHeaders });
  },
};
