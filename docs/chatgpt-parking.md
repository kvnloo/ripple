# Ephemeral intent surface

Parked from the 2026-09-12 ChatGPT thread. **UI/UX only.** Language, schema, and participation contract stay in AODL.

## What the thread actually asked for

Vagueness is relative to context. “Make me a landing page like Linear, but warmer” is specified *if* the agent has Linear, taste memory, and prior design failures. The scarce resource is continuity of thought, not another admin screen.

So the UI is not a form. It is a **live projection of unresolved intent**:

- While the person talks or types, preprocess the problem space.
- Surface only the question whose expected reduction in later error beats the interruption.
- As that question is answered (memory, research, inference, or a tap), the control **disappears**.
- Modality is chosen per gap: text, sketch, stylus, slider — not a widget zoo.

Ask when information is unknown and high-impact. Do not ask when it is known, recoverable, or inferable.

## Niche

AODL decides *why* to interrupt and *what* was learned. This package is the interruption: one object, on the composer, that captures a **declaration**.

Existing wheels we refuse to reinvent here: tldraw, React Flow, Monaco, Figma. Affordance routing can come later. The pretotype is in-memory declared text + stylus log + at most two chips.

## Participation

Automate unwanted friction. Preserve chosen challenge. The same outcome can be correct while stripping the part of the work the human wanted to do. This surface records `annotation` / `gate` / `declare`. It does not impersonate a `humanGate` schema field.

## Explicitly not in this repo

| Idea from the thread | Where it lives |
|---|---|
| Intent ≠ plan ≠ observed; `openQuestions` as IR | Rejected as HOTL. AODL profile maps interrupts to `humanGate` / tool / memory |
| 16 visual topologies as a gallery | AODL `encodings/visual.json` + Pages catalog |
| Speculative Kerdoios compiler, LandingPageGym | Kerdoios / Evolution Lab |
| Tiny-net armies, SFT | sft-svlm / Evolution Lab |
| Orbs, cores, OpenAvatar | Not the product |

## Zoom (design language, not IR)

Large unit (the declared sentence) → pattern of dots and wires **inside** that unit → still a node. Cores in the AODL catalog are a decoder for Pages. They are not what Dash mounts.
