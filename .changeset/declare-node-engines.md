---
"@charivo/llm": patch
"@charivo/stt": patch
"@charivo/tts": patch
---

Declare `engines: { node: ">=22.0.0" }`. These packages depend on the `openai`
SDK v7, which requires Node 22, so the floor already applied — it was just
reported against `openai` rather than against the charivo package that pulled
it in. Declaring it makes the requirement visible on each package's npm page
and checkable by the package manager, and replaces the prose that had started
being copied into every install surface.
