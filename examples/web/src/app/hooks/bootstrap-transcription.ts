/**
 * The one fetch/parse/error path behind both streaming transcribers. Neither
 * ever sees the API key: each hands its session request to a server route that
 * spends the key and answers with what that transport needs to connect -- which
 * on the WebSocket path is itself a short-lived credential, see below. They
 * differ only in the route and in which fields carry that answer, so `pick`
 * reads those and returns null when the payload lacks them. That case and a
 * response that was not ok both throw, but only the not-ok case may quote the
 * raw body: an ok response can still carry the WebSocket path's credential even
 * when `pick` rejects its shape, so that message never repeats the body or any
 * field read out of it.
 */
export async function bootstrapTranscription<T>(
  endpoint: string,
  sessionRequest: unknown,
  pick: (payload: Record<string, unknown>) => T | null,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionRequest),
  });

  const rawBody = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    // Leave parsed undefined; the raw body goes into the error below.
  }
  const payload: Record<string, unknown> =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};

  // Identity, not truthiness: `pick` is generic, so a future picker returning
  // an empty string or a zero would otherwise read as a failed bootstrap.
  const bootstrap = response.ok ? pick(payload) : null;
  if (bootstrap === null) {
    const message = [payload.error, payload.details]
      .filter((part): part is string => typeof part === "string")
      .join(": ");
    if (message) {
      throw new Error(message);
    }
    if (!response.ok) {
      throw new Error(
        `Transcription bootstrap failed with ${response.status}: ${rawBody}`,
      );
    }
    // A 200 that `pick` still rejects (e.g. a token with no usable url) may be
    // holding a minted credential, so this message never echoes the body.
    throw new Error(
      `Transcription bootstrap returned ${response.status} with an unusable payload`,
    );
  }

  return bootstrap;
}
