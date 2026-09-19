---
name: complete-tasks
description: "Use when the user asks Codex to complete all open Linear tickets or a tracker queue end-to-end: pick tickets one by one, use the Linear workflow, address bugs, debug Cloudflare/MCP/browser issues when relevant, validate, deploy each completed story to production, attach proof such as screenshots to story comments, move tickets to Done, and repeat until no eligible tickets remain."
---

# Complete Tasks

## Purpose

Run the user's full ticket-completion goal as one coordinated flow. This skill is intentionally short: it links existing workflow skills and sets the finish criteria for this repo-style delivery loop.

## Required Skill Chain

Load and follow these skills when applicable; do not duplicate their content here.

- `$task-delivery-loop`: outer queue loop for selecting, delivering, validating, commenting, deploying, and continuing ticket by ticket.
- `$linear`: Linear issue reading, comments, images, attachments, evidence comments, and status updates.
- `$address-bug`: bug/regression flow for tickets that report broken behavior, failed smoke tests, production issues, or regressions.
- `$mcp-on-cloudflare`: Cloudflare Worker/MCP hardening and deploy checks when the ticket touches MCP or Cloudflare-hosted gateway behavior.
- `$chatgpt-mcp-debug`: local-first MCP/ChatGPT connector debugging when OAuth, discovery, tools, or Streamable HTTP behavior is involved.
- `$agents-browser-debug`: real browser, DevTools/CDP, or Playwright guidance for UI, OAuth, localhost, PWA, and browser-only verification.
- `$review-refine-loop`: independent review, cleanup, and refinement loop before considering code complete.
- `$critical-http-security-auditor`: final goal-level HTTP/security audit after all tickets are otherwise complete, especially for Cloudflare Worker/Pages, API, auth, token, cache, file, deployment, and private-data boundaries.

## Flow

1. Read project instructions and persistent handoff/state files before changing code or tracker state.
2. Identify the intended Linear project or workstream from the user request, repository context, issue prefixes, and tracker metadata.
3. Refresh the Linear queue across all eligible non-final states, including Backlog, Todo, In Progress, In Review, and Reopened when those states exist.
4. Process exactly one ticket at a time.
5. For each ticket, use `$linear` to read the full issue, extract issue images, read all comments, extract comment images, and fetch relevant attachments before deciding what to do.
6. If the ticket is a bug or regression, use `$address-bug`: understand the failure, reproduce where practical, add focused regression coverage, fix the cause, and validate the real behavior.
7. If the ticket touches Cloudflare Worker MCP behavior or ChatGPT connector flows, use `$mcp-on-cloudflare` and `$chatgpt-mcp-debug` as needed.
8. For UI, PWA, OAuth, browser, or visual changes, use `$agents-browser-debug` and collect browser-rendered evidence. Prefer Playwright screenshots when they genuinely prove the work.
9. Run relevant focused and broad validation from the project docs or task requirements.
10. Use `$review-refine-loop` when code changed, or perform an equivalent independent review/cleanup pass when the exact skill is unavailable.
11. Deploy the current code to production after each completed story when the user asks for deployed completion.
12. Verify production after deploy, including health checks, deployment URL, canonical URL, or project-specific smoke tests.
13. Attach proof to the Linear story comment, including what changed or was verified, validation results, screenshot/evidence paths or attachment IDs, deploy URL/version, and residual risk if any.
14. Move the ticket to Done only after code is complete, deployed to production, proof is attached, review/cleanup is complete, and acceptance criteria are satisfied.
15. Refresh the queue after every ticket and repeat until no eligible tickets remain.
16. After the queue is empty and all tickets are Done/deployed/proofed, run a final goal-level `$review-refine-loop` with `$critical-http-security-auditor` as a security-focused completion gate. Address any Critical/High findings before calling the goal complete.

An explicit user instruction to stop or pause after the current ticket supersedes the outer loop. Finish and persist the current ticket, then do not refresh the queue, select a ticket, or mutate another ticket until the user directly resumes processing, because the pause boundary must remain observable and reversible.

## Finish Criteria

Finish only when all of these are true:

- No eligible Linear tickets remain in Backlog, Todo, In Progress, In Review, Reopened, or equivalent non-final states.
- Every completed ticket was processed individually with full issue/comment/image/attachment context.
- Every code-changing ticket has relevant validation, review/cleanup, production deploy verification, and proof attached in Linear comments.
- Every UI/browser ticket has real browser or Playwright evidence when such evidence can prove the work.
- Every completed ticket is deployed to production, not merely moved to review.
- Required repo docs or state files are updated for material behavior, validation, deployment, or queue-state changes.
- Final goal-level review-refine and critical HTTP security audit have been run after all tickets are otherwise complete, with Critical/High findings fixed or explicitly documented as not applicable.
- No commit was created unless the user explicitly requested one.

If any ticket is blocked, comment the blocker and best-effort evidence in Linear, persist local context, continue with other eligible tickets when possible, and report remaining blocked work clearly.
