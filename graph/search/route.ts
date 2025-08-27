// app/api/graph/search/route.ts
export const runtime = "node";

const TENANT_ID = process.env.MICROSOFT_TENANT_ID!;
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID!;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET!;

type Body = { userUpn: string; q: string; top?: number };

let cachedToken = "";
let tokenExpiresAt = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`token_error: ${err}`);
  }

  const data = await res.json();
  cachedToken = data.access_token as string;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return cachedToken;
}

export async function POST(req: Request) {
  try {
    const { userUpn, q, top = 10 } = (await req.json()) as Body;

    if (!userUpn || !q) {
      return new Response(JSON.stringify({ error: "missing userUpn or q" }), { status: 400 });
    }

    const token = await getToken();

    const url = new URL(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userUpn)}/messages`);
    url.searchParams.set("$top", String(Math.max(1, Math.min(50, top))));
    url.searchParams.set("$search", `"${q}"`); // simple KQL, e.g. from:stacy subject:invoice

    const ms = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "ConsistencyLevel": "eventual",
      },
    });

    const data = await ms.json();
    return new Response(JSON.stringify(data), { status: ms.status });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
  }
}
