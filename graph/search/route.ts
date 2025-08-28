// app/api/graph/search/route.ts
export const runtime = "node";

const TENANT_ID = process.env.MICROSOFT_TENANT_ID!;
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID!;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET!;

type Body = {
  userUpn: string;
  q?: string;                 // optional search query
  top?: number;               // 1..50
  folder?: string;            // e.g. "Inbox", "SentItems"
  select?: string[];          // optional select fields
};

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
  if (!res.ok) throw new Error(`token_error: ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token as string;
  tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return cachedToken;
}

export async function POST(req: Request) {
  try {
    const { userUpn, q, top = 10, folder, select } = (await req.json()) as Body;
    if (!userUpn) return new Response(JSON.stringify({ error: "missing userUpn" }), { status: 400 });

    const token = await getToken();

    const base =
      folder
        ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userUpn)}/mailFolders/${encodeURIComponent(folder)}/messages`
        : `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userUpn)}/messages`;

    const url = new URL(base);
    url.searchParams.set("$top", String(Math.max(1, Math.min(50, top))));
    // Default ordering: SentItems by sentDateTime, others by receivedDateTime
    const order = (folder?.toLowerCase() === "sentitems") ? "sentDateTime desc" : "receivedDateTime desc";
    url.searchParams.set("$orderby", order);
    if (select?.length) url.searchParams.set("$select", select.join(","));
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

    // Only add $search (and Consistency header) if q is provided & non-empty
    if (q && q.trim()) {
      url.searchParams.set("$search", `"${q}"`);
      headers["ConsistencyLevel"] = "eventual";
    }

    const ms = await fetch(url, { headers });
    const data = await ms.json();
    return new Response(JSON.stringify(data), { status: ms.status });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
  }
}
