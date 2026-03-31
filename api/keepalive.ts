export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://nkabxuelejvvdwyvtwmz.supabase.co";
  const endpoint = `${supabaseUrl}/functions/v1/keepalive`;

  try {
    const upstream = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const text = await upstream.text();
    return res.status(upstream.status).send(text);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Keepalive failed",
    });
  }
}
