# Conversation Context Compression Flow

## Purpose
- Prevents the agent prompt from breaching the target token budget by turning older tool-call heavy stretches into a single user-role summary message.
- Preserves mission-critical steps (recent tool batches, notebook state, cache breakpoints) while freeing enough budget for the upcoming user/assistant turn.
- Provides telemetry hooks to observe when summarization triggers, succeeds, or falls back.

## Trigger Surface & Entry Point
1. `src/extension/intents/node/agentIntent.ts – AgentIntentInvocation.buildPrompt`
   - Renders `AgentPrompt` with cache breakpoints enabled whenever `ConfigKey.SummarizeAgentConversationHistory` is true.
   - If `PromptRenderer` throws `BudgetExceededError`, the method retries with `triggerSummarize: true` so that the history component performs inline compression. Tool-call results captured by the exception metadata are merged into `promptContext.toolCallResults` before retrying.
2. `src/extension/prompts/node/agent/agentPrompt.tsx – AgentPrompt.render`
   - When `enableCacheBreakpoints` is true, the prompt swaps the standard history block for `<SummarizedConversationHistory>` so the renderer can optionally mutate history and surface a `<meta>` carrying summary metadata.

## Detailed Call Chain with Data Flow
1. `agentIntent.ts – AgentIntentInvocation.buildPrompt`
   - Constructs `IBuildPromptContext` (history, `toolCallRounds`, `toolCallResults`, chat variables).
   - On overflow: rerenders with `triggerSummarize: true` which guarantees `SummarizedConversationHistory` mounts the `ConversationHistorySummarizer`.
   - Output: `RenderPromptResult` whose `.messages` already include the compressed user message, plus metadata containing `SummarizedConversationHistoryMetadata`.
2. `agentPrompt.tsx – AgentPrompt.render`
   - Emits base instructions/system envelope and mounts `<SummarizedConversationHistory>` with props `{ promptContext, endpoint, maxToolResultLength, triggerSummarize }`.
   - Provides the same prompt context downstream; no mutation happens here.
3. `summarizedConversationHistory.tsx – SummarizedConversationHistory.render`
   - Shallow-clones `promptContext` to avoid mutating the original reference.
   - If `triggerSummarize` is true:
     - Instantiates `ConversationHistorySummarizer` with current sizing/budget info.
     - Calls `summarizeHistory()` which returns `{ summary, toolCallRoundId }`.
     - Invokes `addSummaryToHistory` to set `round.summary` on either the active `toolCallRounds` list or the appropriate historic turn.
     - Emits `<meta value={new SummarizedConversationHistoryMetadata(...)}/>` so the enclosing renderer can attach metadata to the `RenderPromptResult`.
4. `summarizedConversationHistory.tsx – ConversationHistory.render`
   - Builds the message list that the LLM will see:
     - Current (unsummarized) tool rounds are rendered via `<ChatToolCalls>` as assistant/tool-role entries.
     - When it encounters the first `round.summary`, it injects `<SummaryMessageElement>` which produces a user-role message wrapping the summary in `<Tag name='conversation-summary'>`.
     - Once a summary is encountered inside an older turn, earlier turns are skipped because they are covered by the compressed block.
   - Output: `PrioritizedList` combining the surviving user/assistant/tool messages and the new summary message.
5. `summarizedConversationHistory.tsx – ConversationHistorySummarizer`
   - Delegates to `SummarizedConversationHistoryPropsBuilder.getProps()` to decide the slice to summarize:
     - If multiple active tool rounds exist, it trims the newest round (the one that overflowed) and summarizes the previous round of the same turn.
     - Otherwise, it switches the context into `isContinuation` mode and targets the last round of the previous turn (common when the latest user utterance caused overflow).
   - Builds the summarization prompt via either `ConversationHistorySummarizationPrompt` (simple/full variants) or `AgentPromptWithSummaryPrompt` when prompt-caching experiments are enabled.
   - Calls `endpoint.makeChatRequest2` with temperature 0 and `tool_choice: 'none'` (full mode only). Cache breakpoints are added or stripped depending on experiments.
   - Validates the returned text against `PromptSizing.tokenBudget` (and optional `maxSummaryTokens`). On success, returns the summary text plus the `toolCallRoundId` to annotate.
6. `src/extension/intents/node/toolCallingLoop.ts – ToolCallingLoop.runOne`
   - Consumes the prompt result. When it sees `SummarizedConversationHistoryMetadata` in `buildPromptResult.metadata` it stores the metadata on the active `Turn` via `turn.setMetadata` so higher layers can persist it.
   - Keeps iterating tool calls until completion; the compressed prompt is already being used for the live LLM call at this point.
7. `src/extension/prompt/node/defaultIntentRequestHandler.ts – DefaultIntentRequestHandler.resultWithMetadatas`
   - After the turn finishes, merges `SummarizedConversationHistoryMetadata` into the `chatResult.metadata.summary` payload that is sent back to the VS Code client. This allows history replays and persist/restore flows to know which `IToolCallRound` has been summarized.
8. `src/extension/prompt/node/chatParticipantRequestHandler.ts – addHistoryToConversation/normalizeSummariesOnRounds`
   - When a subsequent chat request is handled, `normalizeSummariesOnRounds(turns)` reads the stored `metadata.summary` objects and rehydrates `round.summary` on historical turns so `SummarizedConversationHistory` can recognize previously summarized segments without recomputing them.

## Key Intermediate Data Structures
- `IBuildPromptContext` (`src/extension/prompt/common/intents.ts`): carries `history`, `toolCallRounds`, `toolCallResults`, notebook edits, etc. This structure is cloned/mutated just before rendering to ensure the summarizer can safely drop the most recent tool round when needed.
- `IToolCallRound` + `round.summary: string | undefined`: every tool batch (assistant→tool→assistant) lives inside a round, and the summary is stored directly on the round so renderers can replace a whole slice with a single user-role message.
- `SummarizedConversationHistoryMetadata` (`summarizedConversationHistory.tsx`): holds `{ toolCallRoundId, text }` and is propagated through prompt metadata → `Turn` metadata → persisted conversation metadata.
- `PromptSizing` (`@vscode/prompt-tsx`): used to count tokens for both the summarization prompt and the returned summary text.
- `ChatResponseProgressPart2` notifications: emitted from `ConversationHistorySummarizer.summarizeHistory()` to inform the UI that summarization is happening before the actual user-visible reply resumes.

## Message Role Expectations
- Summaries are always emitted as a `UserMessage` containing `<Tag name='conversation-summary'>…</Tag>` so downstream cache and safety layers treat them as user-provided context.
- The latest assistant/model outputs remain untouched; only the targeted `toolCallRound` and anything older cease to be rendered verbatim once a summary bubble exists.
- Tool call payloads continue to appear as assistant/tool-role entries for rounds newer than the summary boundary.

## Guardrails & Feature Flags
- `ConfigKey.SummarizeAgentConversationHistory` gates the entire mechanism.
- `ConfigKey.Internal.SummarizeAgentConversationHistoryThreshold` defines the base budget used when deciding to trigger summarization.
- `ConfigKey.Internal.AgentHistorySummarizationMode` can force `simple` vs `full` summarization.
- `ConfigKey.Internal.AgentHistorySummarizationForceGpt41` and `AgentHistorySummarizationWithPromptCache` control which endpoint/prompt template is used.
- `maxSummaryTokens` prop (if supplied) adds an extra hard cap beyond the prompt sizing budget; violations raise `"Summary too large"` which bubbles to the fallback renderer.
- On any render/request failure the system logs telemetry (`summarizedConversationHistory`, `triggerSummarizeFailed`) and re-renders without cache breakpoints so the user still receives an answer.

## Post-Compression Flow
- LLM request for the active turn already contains the compressed history; no extra stitching happens afterward.
- Once the round completes, metadata describing the summary travels up through `ToolCallingLoop` → `DefaultIntentRequestHandler` → `ChatParticipantRequestHandler` so the next agent turn automatically reuses the summary without recomputing it.
- `DefaultToolCallingLoop` invalidates virtual tool grouping caches whenever summary metadata appears, ensuring grouping heuristics account for the shortened history.
- Persisted conversations (e.g., conversation store or simulator replays) call `normalizeSummariesOnRounds` during reload, so the prompt renderer sees the same `round.summary` values even across sessions.

## Open Questions / Noted Gaps
- `SummarizedConversationHistoryPropsBuilder.getProps()` throws `Error('Nothing to summarize')` when both active rounds and history are empty; upstream callers rely on this never happening but the overflow scenario after a lone user turn may still hit it.
- Tool-call truncation during summarization (`maxToolResultLength` ≈ 50% of prompt budget) can remove arguments/results that future retries might need; there is no explicit signaling when this occurs.
- Notebook detection parses `RunNotebookCell` JSON arguments inline; schema drift could silently disable notebook summaries.
- Prompt-cache experiments (`AgentHistorySummarizationWithPromptCache`) modify the summarization template but the cache key mutation strategy is not fully documented, raising questions about cache hit rates after history mutation.
