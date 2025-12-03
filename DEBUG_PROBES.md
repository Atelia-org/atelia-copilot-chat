# Debug Probes for Half-Context Summarization Investigation

> **Created:** 2025-12-02
> **Updated:** 2025-12-03
> **Purpose:** Track temporary console.log probes for debugging summarization timeout issues
> **Remove after:** Issue resolved

## Runtime Debug Flags

### SummarizationDebugFlags

A global object exposed at runtime for toggling summarization behavior.

**Location:** `src/extension/prompts/node/agent/summarizedConversationHistory.tsx`

**Usage in Developer Console (Extension Development Host):**
```js
// Check current state
globalThis.__SUMMARIZATION_DEBUG_FLAGS__

// Disable tool injection (to test if tools cause empty summary)
globalThis.__SUMMARIZATION_DEBUG_FLAGS__.injectTools = false

// Re-enable tool injection
globalThis.__SUMMARIZATION_DEBUG_FLAGS__.injectTools = true

// Enable verbose console logging
globalThis.__SUMMARIZATION_DEBUG_FLAGS__.verboseLogging = true
```

**VS Code Commands:**
- `github.copilot.debug.toggleSummarizationToolInjection` - Toggle tool injection via UI

**Properties:**
| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `injectTools` | boolean | `true` | Whether to inject `tools` + `tool_choice=none` into summarization requests |
| `verboseLogging` | boolean | `false` | Enable extra console.log output |

**Testing Workflow:**
1. Start EDH with real conversation
2. Open Developer Console (Help > Toggle Developer Tools)
3. Run `globalThis.__SUMMARIZATION_DEBUG_FLAGS__.injectTools = false`
4. Trigger dry-run: `github.copilot.debug.dryRunSummarization`
5. Compare results with `injectTools = true`

## Probe Locations

### PROBE 1 - Non-stream response.text() timing
**File:** `src/platform/endpoint/node/chatEndpoint.ts`
**Function:** `defaultNonStreamChatResponseProcessor`
**Line:** ~61-68 (after edit)
```typescript
const startTime = Date.now();
console.log(`[SUMMARIZE DEBUG] defaultNonStreamChatResponseProcessor: response.text() 开始 @ ${new Date().toISOString()}`);
const textResponse = await response.text();
const elapsed = Date.now() - startTime;
console.log(`[SUMMARIZE DEBUG] defaultNonStreamChatResponseProcessor: response.text() 完成, 耗时 ${elapsed}ms, 响应长度 ${textResponse.length} chars`);
console.log(`[SUMMARIZE DEBUG] Response preview (first 500 chars): ${textResponse.substring(0, 500)}`);
```

### PROBE 2 - Summarization request timing
**File:** `src/extension/prompts/node/agent/summarizedConversationHistory.tsx`
**Function:** `ConversationHistorySummarizer.getSummary`
**Line:** ~508-525 (after edit)
```typescript
const requestStartTime = Date.now();
console.log(`[SUMMARIZE DEBUG] makeChatRequest2 开始 @ ${new Date().toISOString()}, mode=${mode}, stream=false`);
console.log(`[SUMMARIZE DEBUG] Prompt messages count: ${summarizationPrompt.length}`);
// ... await endpoint.makeChatRequest2(...) ...
const requestElapsed = Date.now() - requestStartTime;
console.log(`[SUMMARIZE DEBUG] makeChatRequest2 完成, 耗时 ${requestElapsed}ms, response.type=${summaryResponse.type}`);
```

### PROBE 3 - Network request timing
**File:** `src/platform/networking/common/networking.ts`
**Function:** `postRequest`
**Line:** ~313-316 (after edit)
```typescript
console.log(`[SUMMARIZE DEBUG] postRequest: 发起请求 @ ${new Date().toISOString()}`);
console.log(`[SUMMARIZE DEBUG] postRequest: timeout=${requestTimeoutMs}ms, stream=${body.stream}`);
console.log(`[SUMMARIZE DEBUG] postRequest: endpoint=...`);
```

### PROBE 4 - Response processing path
**File:** `src/platform/endpoint/node/chatEndpoint.ts`
**Function:** `ChatEndpoint.processResponseFromChatEndpoint`
**Line:** ~276-290 (after edit)
```typescript
console.log(`[SUMMARIZE DEBUG] processResponseFromChatEndpoint: useResponsesApi=${this.useResponsesApi}, supportsStreaming=${this._supportsStreaming}`);
// ... path selection logs ...
```

### PROBE 5 - SSE stream chunks
**File:** `src/platform/networking/node/stream.ts`
**Function:** `SSEProcessor.processSSEInner`
**Line:** ~298-310 (after edit)
```typescript
let chunkCount = 0;
const streamStartTime = Date.now();
console.log(`[SUMMARIZE DEBUG] SSE stream 开始 @ ${new Date().toISOString()}`);
for await (const chunk of this.body) {
    chunkCount++;
    console.log(`[SUMMARIZE DEBUG] SSE chunk #${chunkCount}: ${chunkStr.length} bytes @ +${Date.now() - streamStartTime}ms`);
    // ... chunk content preview ...
}
```

### PROBE 6 - Request body dump (NEW)
**File:** `src/extension/prompt/node/chatMLFetcher.ts`
**Function:** `ChatMLFetcherImpl.fetchMany`
**Line:** ~120-140 (after edit)
```typescript
// Compute MD5 hash for quick comparison
const requestBodyHash = crypto.createHash('md5').update(requestBodyJson).digest('hex');
console.log(`[SUMMARIZE DEBUG] fetchMany: debugName="${debugName}", ourRequestId="${ourRequestId}"`);
console.log(`[SUMMARIZE DEBUG] fetchMany: requestBody MD5 hash="${requestBodyHash}"`);
// For summarization requests, dump full body to /tmp/
if (debugName.includes('summarize') || debugName.includes('dryRun')) {
    fs.writeFileSync(dumpPath, requestBodyJson, 'utf-8');
}
```
**Output files:** `/tmp/llm-request-*.json`

## How to Remove

Search for `[SUMMARIZE DEBUG]` in the codebase and remove all related console.log statements:

```bash
grep -rn "\[SUMMARIZE DEBUG\]" src/ --include="*.ts" --include="*.tsx"
```

## Expected Output

When summarization runs, you should see logs like:

```
[SUMMARIZE DEBUG] makeChatRequest2 开始 @ 2025-12-02T10:00:00.000Z, mode=Full, stream=false
[SUMMARIZE DEBUG] Prompt messages count: 15
[SUMMARIZE DEBUG] postRequest: 发起请求 @ 2025-12-02T10:00:00.010Z
[SUMMARIZE DEBUG] postRequest: timeout=30000ms, stream=false
[SUMMARIZE DEBUG] processResponseFromChatEndpoint: useResponsesApi=false, supportsStreaming=true
[SUMMARIZE DEBUG] → Using STREAMING path (defaultChatResponseProcessor/SSE)
[SUMMARIZE DEBUG] SSE stream 开始 @ 2025-12-02T10:00:00.500Z
[SUMMARIZE DEBUG] SSE chunk #1: 1024 bytes @ +100ms
...
[SUMMARIZE DEBUG] makeChatRequest2 完成, 耗时 55000ms, response.type=success
```

## Key Questions to Answer

1. **Which path is taken?** STREAMING vs NON-STREAMING vs ResponsesAPI
2. **Where does time go?** Between which probes is the most delay?
3. **Does response arrive?** Is response.text() or SSE chunks received?
4. **Is there a timeout?** Does it hit the 30s limit?
