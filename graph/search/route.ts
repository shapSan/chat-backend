// app/api/graph/search/route.ts
export const runtime = "node"; // keep secrets server-side

const TENANT_ID = process.env.AZURE_TENANT_ID!;
const CLIENT_ID = process.env.AZURE_CLIENT_ID!;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET!;

type Body = { userUpn: string; q: string; top?: number };

export async function POST(req: Request) {
  const { userUpn, q, top = 10 } = (await req.json()) as Body;

  // (optional) simple allowlist to prevent abuse:
  if (!userUpn.endsWith("@yourdomain.com")) {
    return new Response(JSON.stringify({ error: "forbidden user/domain" }), { status: 403 });
  }

  const tokenRes = await fetch(
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
      // (optional) next: { revalidate: 300 } // mild caching hint for the token
    }
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(JSON.stringify({ error: "token_error", detail: err }), { status: 500 });
  }

  const { access_token } = await tokenRes.json();

  const url = new URL(`https://graph.microsoft.com/v1.0/users/${userUpn}/messages`);
  url.searchParams.set("$top", String(top));
  url.searchParams.set("$search", `"${q}"`);

  const msRes = await fetch(url, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      ConsistencyLevel: "eventual",
    },
  });

  const data = await msRes.json();
  return new Response(JSON.stringify(data), { status: msRes.status });
}
