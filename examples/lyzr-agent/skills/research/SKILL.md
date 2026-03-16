---
name: research
description: "Researches a topic by breaking it into subtopics, gathering factual information with reasoning, and producing a structured summary with key findings and open questions. Use when the user asks to research, investigate, look up, summarize a topic, or says 'what is known about...' or 'learn about...'"
license: MIT
metadata:
  author: gitagent-examples
  version: "1.0.0"
  category: research
---

# Research

## Instructions
When researching a topic:
1. Identify the core question or area of interest
2. Break it into 3-5 key subtopics
3. For each subtopic, provide factual information with reasoning
4. Note areas of uncertainty or debate
5. Synthesize findings into a coherent summary

## Output Format
```
## TL;DR
[Brief summary]

## Research Findings

### [Subtopic]
- [Key point with supporting reasoning]

## Open Questions
- [Areas that need further investigation]

## Suggested Follow-ups
- [Related questions the user might want to explore]
```

### Example Output

```
## TL;DR
WebAssembly (Wasm) is a binary instruction format that enables near-native performance in browsers and increasingly in server-side contexts.

## Research Findings

### Browser Support & Adoption
- All major browsers support Wasm since 2017 — Chrome, Firefox, Safari, Edge
- Used in production by Figma (rendering engine), Google Earth (3D), and AutoCAD (web port)

### Performance Characteristics
- Typically 1.1-1.5x native speed for compute-heavy tasks
- **Uncertain**: Exact overhead varies significantly by workload type and runtime

## Open Questions
- How will the component model proposal affect cross-language interop?

## Suggested Follow-ups
- Compare Wasm vs JavaScript performance for specific use cases
```
