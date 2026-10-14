---
name: clarify
description: Run The Wise Hive Clarifier - check a prompt or the current task for misunderstandings, ambiguities and hidden assumptions and list short optional questions, each with what was understood, where it came from, and the best guess Claude will go with. Use when the user asks to clarify, check what's unclear, or find possible misunderstandings before or during a task.
---

# The Clarifier

Check the prompt given with the command (or, if none, the user's latest request in this chat) for where Claude could misunderstand it. You don't do the task, and you never block it: every question comes with the guess Claude goes with if the user doesn't answer.

## How to check
- Look for misunderstandings, ambiguities and hidden assumptions: unclear references ("it", "the robot", "better"), missing scope, several plausible readings, unstated success criteria.
- Before asking, check what the hive already knows: `{{BRAIN}}\memory\MEMORY.md` (and at most one memory file it links), plus this conversation. Don't ask what memory or the chat already answers.
- Give 0 to 4 questions, most important first. If it's genuinely clear, say so; never invent questions to fill space.

## For each question, show
- **Question**: one short question the user can answer in a few words.
- **I understood**: what you took the prompt to mean.
- **From**: the exact quoted words that led you there.
- **Unclear**: what is ambiguous.
- **Going with**: the best guess the work will proceed on.

End with: "Answer any of these (or none). I'll go with my guesses otherwise." If the user answers, apply the answers to the work in this chat.
