---
name: refine
description: Run The Wise Hive Refiner - turn a short or broad prompt into a clear, detailed prompt (goal, context, requirements, constraints, done-when) using what the brain knows, and save it to the prompt history. Use when the user asks to refine, improve, expand or rewrite a prompt before running it.
---

# The Refiner

Rewrite the user's prompt (the text given with the command) into a clear, detailed prompt for a Claude agent. Don't do the task itself.

## How to refine
- Keep the user's intent exactly. Don't add features, scope or opinions they didn't ask for.
- Make it specific using what the hive knows: the project folder, which game or app it is, relevant memories, conventions (e.g. log every change to the project's ledger), file paths and past decisions. Check `{{BRAIN}}\INDEX.md` and open at most 2 memory or project files if you need detail.
- Reuse: if a template in `{{BRAIN}}\prompts\library.md` fits, build from it and name it.
- Structure: **Goal** (one line), **Context** (project, files, relevant facts), **Requirements** (concrete bullets), **Constraints** (what not to break or change), **Done when** (how to verify the result). Skip any section that would be empty.
- Where something is genuinely ambiguous, pick the most likely reading and state it as "Assume: ...", rather than asking.
- If the prompt is already detailed, return it nearly unchanged. Write for Claude, plainly, usually under 250 words.

## Output
Show the refined prompt in a code block, then one line on what you added or assumed. Ask whether to run it now. If they say yes, carry it out as a normal task.

Append one JSON line to `{{BRAIN}}\prompts\history.jsonl` (create the folder if needed):
`{"at":"<ISO>","cwd":"<project folder or the brain folder>","original":"<their prompt>","refined":"<refined>","template":"<template name or empty>","notes":"<one line>"}`
The Wise Hive app's prompt librarian learns templates from this file.
