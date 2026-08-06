/**
 * supabase-js's `functions.invoke()` throws a `FunctionsHttpError` whenever the edge
 * function responds with a non-2xx status. That error's `.message` is *always* the
 * hardcoded string "Edge Function returned a non-2xx status code" — it never contains
 * whatever JSON body the function actually sent back. The real error text lives on
 * `error.context`, a `Response` object that has to be read (and JSON-parsed) separately.
 *
 * Every toast that shows `error.message` straight from an `invoke()` catch block is
 * showing this generic placeholder instead of the function's real error — this helper
 * unwraps it properly, so backend error messages actually reach the user.
 */

const GENERIC_INVOKE_MESSAGE = "Edge Function returned a non-2xx status code";

type ResponseLike = {
  clone?: () => ResponseLike;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

function isResponseLike(value: unknown): value is ResponseLike {
  return !!value && typeof value === "object" && ("json" in value || "text" in value);
}

export async function getFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: unknown }).context;
    if (isResponseLike(context)) {
      try {
        const jsonResponse = typeof context.clone === "function" ? context.clone() : context;
        if (typeof jsonResponse.json === "function") {
          const body = await jsonResponse.json();
          if (body && typeof body === "object") {
            const message = (body as { error?: unknown; message?: unknown }).error ?? (body as { message?: unknown }).message;
            if (typeof message === "string" && message.trim()) return message;
          }
        }
      } catch {
        // Fall through to attempt `text()` below.
      }

      try {
        const textResponse = typeof context.clone === "function" ? context.clone() : context;
        if (typeof textResponse.text === "function") {
          const text = (await textResponse.text()).trim();
          if (text) return text;
        }
      } catch {
        // Response body wasn't readable — fall through below.
      }
    }
  }

  if (error instanceof Error) {
    const message = (error.message || "").trim();
    if (message && message !== GENERIC_INVOKE_MESSAGE) return message;
  }

  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    const message = ((error as { message: string }).message || "").trim();
    if (message && message !== GENERIC_INVOKE_MESSAGE) return message;
  }

  return fallback;
}

