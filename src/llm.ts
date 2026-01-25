export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type StreamResult =
  | { type: "chunk"; content: string }
  | { type: "done" }
  | { type: "error"; message: string; aborted?: boolean };

export type StreamOpenAIChatOpts = {
  timeoutMs?: number;
  log?: (msg: string) => void;
  maxTokens?: number;
  temperature?: number;
};

/**
 * Streams a chat completion from an OpenAI-compatible endpoint using Server-Sent Events.
 * Yields chunks as they arrive, allowing for progressive rendering.
 * baseUrl must not include /chat/completions (e.g. https://your-provider.com/v1).
 * Combines user signal with an optional timeout signal. The timeout also
 * aborts the body read; if the server never sends or closes, we yield "Request aborted."
 */
export async function* streamOpenAIChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  opts?: StreamOpenAIChatOpts
): AsyncGenerator<StreamResult> {
  const timeoutMs = opts?.timeoutMs ?? 0;
  const log = opts?.log ?? (() => {});

  const url = baseUrl.replace(/\/$/, "") + "/chat/completions";

  const timeoutController =
    timeoutMs > 0 ? new AbortController() : undefined;
  let timeoutId: NodeJS.Timeout | undefined;
  if (timeoutController) {
    timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  }

  const mergedSignal =
    timeoutController && signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController
        ? timeoutController.signal
        : signal;

  const clearTimer = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  log("fetch start");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(opts?.maxTokens != null && { max_tokens: opts.maxTokens }),
        ...(opts?.temperature != null && { temperature: opts.temperature }),
      }),
      signal: mergedSignal,
    });
  } catch (e) {
    clearTimer();
    log(`fetch error: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.name === "AbortError") {
      yield {
        type: "error",
        message: "Request aborted.",
        aborted: true,
      };
    } else {
      const err = e instanceof Error ? e.message : String(e);
      yield { type: "error", message: `Network error: ${err}` };
    }
    return;
  }

  log(`fetch ok status=${res.status} ct=${res.headers.get("content-type") ?? ""}`);

  if (!res.ok) {
    clearTimer();
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j?.error?.message ?? detail;
    } catch {
      try {
        detail = await res.text();
      } catch {
        // ignore text parse errors
      }
    }
    yield {
      type: "error",
      message: `API error (${res.status}): ${detail}`,
    };
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    clearTimer();
    yield { type: "error", message: "Response body is empty" };
    return;
  }

  const abortHandler = () => {
    try {
      reader.cancel();
    } catch {
      // ignore
    }
  };
  if (mergedSignal) {
    mergedSignal.addEventListener("abort", abortHandler);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let fallbackBuffer = "";
  let readCount = 0;
  let yieldCount = 0;
  let loggedDeltaKeys = false;
  let loggedParseErr = false;

  try {
    while (true) {
      readCount++;
      const { done, value } = await reader.read();
      if (readCount <= 2) {
        log(`read #${readCount} done=${done} valueLen=${value?.length ?? 0}`);
      }

      if (done) {
        clearTimer();
        log(`body done yieldCount=${yieldCount} bufferLen=${buffer.length}`);
        if (yieldCount === 0 && fallbackBuffer.trim().startsWith("{")) {
          try {
            const data = JSON.parse(fallbackBuffer) as {
              choices?: Array<{ message?: { content?: string } }>;
            };
            const c = data?.choices?.[0]?.message?.content;
            if (typeof c === "string") yield { type: "chunk", content: c };
          } catch {
            // ignore
          }
        } else {
          const remaining = buffer.trim();
          if (remaining.length > 0 && remaining !== "[DONE]" && remaining !== "data: [DONE]") {
            if (remaining.startsWith("data: ")) {
              try {
                const data = JSON.parse(remaining.slice(6)) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const c = data?.choices?.[0]?.delta?.content;
                if (typeof c === "string") yield { type: "chunk", content: c };
              } catch {
                // ignore
              }
            }
          }
        }
        yield { type: "done" };
        return;
      }

      const decoded = decoder.decode(value, { stream: true });
      if (yieldCount === 0) {
        fallbackBuffer += decoded;
      }
      buffer += decoded;
      const lines = buffer.split("\n");

      buffer = lines[lines.length - 1];

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();

        if (line === "" || line === ":") continue;

        if (line === "[DONE]" || line === "data: [DONE]") {
          clearTimer();
          yield { type: "done" };
          return;
        }

        if (line.startsWith("data: ")) {
          const json = line.slice(6);
          try {
            const data = JSON.parse(json) as {
              choices?: Array<{ delta?: Record<string, unknown> & { content?: string } }>;
            };
            const delta = data?.choices?.[0]?.delta;
            const content = delta?.content;
            if (typeof content === "string") {
              yieldCount++;
              if (yieldCount <= 3) log(`sse yield #${yieldCount} len=${content.length}`);
              yield { type: "chunk", content };
            } else if (delta && !loggedDeltaKeys) {
              loggedDeltaKeys = true;
              log(`sse delta keys: ${Object.keys(delta).join(",")}`);
            }
          } catch (e) {
            if (!loggedParseErr) {
              loggedParseErr = true;
              log(`sse parse err: ${e instanceof Error ? e.message : String(e)} json=${json.slice(0, 120)}...`);
            }
          }
        }
      }
    }
  } catch (e) {
    clearTimer();
    log(`stream catch: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.name === "AbortError") {
      yield {
        type: "error",
        message: "Request aborted.",
        aborted: true,
      };
    } else {
      const err = e instanceof Error ? e.message : String(e);
      yield { type: "error", message: `Streaming error: ${err}` };
    }
  } finally {
    if (mergedSignal) {
      mergedSignal.removeEventListener("abort", abortHandler);
    }
  }
}
