---
"@charivo/realtime": minor
"@charivo/server": minor
---

Move the default OpenAI realtime model from `gpt-realtime-mini` to
`gpt-realtime-2.1-mini`.

OpenAI has deprecated the `gpt-realtime` / `gpt-realtime-mini` family (API
shutdown on 2027-01-20). Sessions that do not pass an explicit `model` now
run on `gpt-realtime-2.1-mini`, the successor OpenAI recommends. Sessions
that set `model` explicitly are unaffected — model strings remain
pass-through. If you stay on an older charivo release past the shutdown
date, pin a supported model explicitly (e.g.
`startSession({ provider: "openai", model: "gpt-realtime-2.1-mini" })`).
