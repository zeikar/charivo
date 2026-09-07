---
"@charivo/llm": minor
"@charivo/stt": minor
"@charivo/tts": minor
---

Upgrade the `openai` dependency from `^4.47.1` to `^7.10.0`. `openai` is a
regular dependency of these packages rather than a peer, so its `node >=22`
engine requirement now reaches consumers transitively — that constraint, not
any change to a charivo API, is why this is a minor.

The SDK's own surface is otherwise unchanged for this repo: the `OpenAI.*` type
namespace, `dangerouslyAllowBrowser`, `baseURL`, per-request `signal`, and the
`chat.completions` / `audio.transcriptions` / `audio.speech` calls all behave as
before, and no charivo type signature moves.

One behavior does change. `ChatCompletionMessageToolCall` is now a union of the
function and custom tool-call shapes, and only the function arm maps onto
`LLMToolCall`. A tool call that declares a `type` other than `"function"` is
rejected as an unsupported tool type rather than misreported as missing
`function.name`; one that omits `type` altogether still resolves through the
`function` checks, so a gateway that never sent the field keeps working. A
non-string `function.arguments` is reported as unparsable instead of being
coerced by `JSON.parse` and reported as the wrong reason.
