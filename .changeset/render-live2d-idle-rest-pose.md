---
"@charivo/render-live2d": patch
---

Ease parameters back to their default rest pose when a motion finishes and the model has no `Idle` motion group to take over. Previously a model without an `Idle` group froze on the last frame of a finished one-shot motion (e.g. an arm left raised after a wave), because the load/save parameter cycle baked in the pose. Models that ship an `Idle` group are unaffected.
