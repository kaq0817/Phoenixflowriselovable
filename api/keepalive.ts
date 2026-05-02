type ApiRequest = {
  method?: string;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  send: (body: unknown) => void;
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
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
    res.status(upstream.status).send(text);
    return;
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Keepalive failed",
    });
    return;
  }
}
