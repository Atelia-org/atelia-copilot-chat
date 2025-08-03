# Edit Providers

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [src/extension/inlineEdits/test/vscode-node/diagnosticsCollection.spec.ts](src/extension/inlineEdits/test/vscode-node/diagnosticsCollection.spec.ts)
- [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/anyDiagnosticsCompletionProvider.ts](src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/anyDiagnosticsCompletionProvider.ts)
- [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/asyncDiagnosticsCompletionProvider.ts](src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/asyncDiagnosticsCompletionProvider.ts)
- [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/diagnosticsCompletions.ts](src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/diagnosticsCompletions.ts)
- [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/importDiagnosticsCompletionProvider.ts](src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/importDiagnosticsCompletionProvider.ts)
- [src/extension/inlineEdits/vscode-node/features/diagnosticsCompletionProcessor.ts](src/extension/inlineEdits/vscode-node/features/diagnosticsCompletionProcessor.ts)
- [src/extension/inlineEdits/vscode-node/features/diagnosticsInlineEditProvider.ts](src/extension/inlineEdits/vscode-node/features/diagnosticsInlineEditProvider.ts)
- [src/extension/xtab/common/promptCrafting.ts](src/extension/xtab/common/promptCrafting.ts)
- [src/extension/xtab/node/xtabProvider.ts](src/extension/xtab/node/xtabProvider.ts)
- [src/extension/xtab/test/common/promptCrafting.spec.ts](src/extension/xtab/test/common/promptCrafting.spec.ts)
- [src/platform/configuration/common/configurationService.ts](src/platform/configuration/common/configurationService.ts)
- [src/platform/inlineEdits/common/dataTypes/xtabPromptOptions.ts](src/platform/inlineEdits/common/dataTypes/xtabPromptOptions.ts)
- [src/platform/inlineEdits/common/workspaceEditTracker/workspaceDocumentEditTracker.ts](src/platform/inlineEdits/common/workspaceEditTracker/workspaceDocumentEditTracker.ts)

</details>



This document covers the edit provider system in the GitHub Copilot Chat extension, which provides AI-powered inline code suggestions and diagnostics-based completions. Edit providers are responsible for generating contextual code edits that appear as inline suggestions in VS Code.

For information about the broader inline edits system architecture, see [Inline Edits System](#4). For workspace and document tracking mechanisms, see [Workspace and Document Tracking](#4.2).

## Provider Architecture

The edit provider system consists of multiple specialized providers that implement different strategies for generating inline code edits:

```mermaid
graph TD
    subgraph "Provider Types"
        XTAB[XtabProvider<br/>AI Language Model]
        DIAG_IMPORT[ImportDiagnosticCompletionProvider<br/>Import Fixes]
        DIAG_ASYNC[AsyncDiagnosticCompletionProvider<br/>Async/Await Fixes]
        DIAG_ANY[AnyDiagnosticCompletionProvider<br/>Generic Diagnostics]
    end
    
    subgraph "Provider Interfaces"
        STATELESS[StatelessNextEditProvider<br/>Base Interface]
        IDIAG[IDiagnosticCompletionProvider<br/>Diagnostics Interface]
    end
    
    subgraph "Orchestration Layer"
        NEXT_EDIT[NextEditProvider<br/>Main Orchestrator]
        DIAG_PROCESSOR[DiagnosticsCompletionProcessor<br/>Diagnostics Orchestrator]
    end
    
    XTAB --> STATELESS
    DIAG_IMPORT --> IDIAG
    DIAG_ASYNC --> IDIAG
    DIAG_ANY --> IDIAG
    
    STATELESS --> NEXT_EDIT
    IDIAG --> DIAG_PROCESSOR
    DIAG_PROCESSOR --> NEXT_EDIT
```

Sources: [src/extension/xtab/node/xtabProvider.ts:70-100](), [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/importDiagnosticsCompletionProvider.ts:179-206](), [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/asyncDiagnosticsCompletionProvider.ts:27-33](), [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/anyDiagnosticsCompletionProvider.ts:37-43]()

## XtabProvider - AI Language Model Provider

The `XtabProvider` is the primary AI-powered edit provider that generates code completions using language models. It extends `ChainedStatelessNextEditProvider` and implements sophisticated context gathering and prompt engineering.

### Core Architecture

```mermaid
graph TB
    subgraph "Request Processing"
        REQ[StatelessNextEditRequest]
        DELAY[Delayer<br/>Debouncing]
        CONTEXT[Context Gathering]
    end
    
    subgraph "Context Sources"
        LANG_CTX[LanguageContextService<br/>AST Context]
        RECENT_DOCS[Recently Viewed Documents]
        EDIT_HISTORY[Edit History]
        CURRENT_FILE[Current File Content]
    end
    
    subgraph "Prompt Engineering"
        PROMPT_OPTIONS[PromptOptions<br/>Configuration]
        SYSTEM_PROMPT[System Prompt Templates]
        USER_PROMPT[User Prompt Generation]
    end
    
    subgraph "Model Inference"
        ENDPOINT[XtabEndpoint<br/>Model Access]
        STREAMING[Streaming Response]
        RESPONSE_PROC[ResponseProcessor<br/>Diff Generation]
    end
    
    REQ --> DELAY
    DELAY --> CONTEXT
    CONTEXT --> LANG_CTX
    CONTEXT --> RECENT_DOCS
    CONTEXT --> EDIT_HISTORY
    CONTEXT --> CURRENT_FILE
    
    CONTEXT --> PROMPT_OPTIONS
    PROMPT_OPTIONS --> SYSTEM_PROMPT
    PROMPT_OPTIONS --> USER_PROMPT
    
    USER_PROMPT --> ENDPOINT
    ENDPOINT --> STREAMING
    STREAMING --> RESPONSE_PROC
```

Sources: [src/extension/xtab/node/xtabProvider.ts:70-100](), [src/extension/xtab/node/xtabProvider.ts:110-137](), [src/extension/xtab/node/xtabProvider.ts:391-500]()

### Context Gathering Strategy

The `XtabProvider` employs multiple context sources to inform its completions:

| Context Source | Purpose | Configuration |
|---|---|---|
| Language Context | AST-based semantic information | `InlineEditsXtabLanguageContextEnabled` |
| Recently Viewed Documents | Cross-file context | `InlineEditsXtabNRecentlyViewedDocuments` |
| Edit History | User editing patterns | `InlineEditsXtabDiffNEntries` |
| Current File | Surrounding code context | `InlineEditsXtabCurrentFileMaxTokens` |

Sources: [src/extension/xtab/node/xtabProvider.ts:335-388](), [src/platform/inlineEdits/common/dataTypes/xtabPromptOptions.ts:31-74]()

### Prompt Engineering

The system supports multiple prompting strategies controlled by configuration:

```mermaid
graph TD
    STRATEGY{Prompting Strategy}
    
    STRATEGY -->|Default| SYSTEM_TEMPLATE[systemPromptTemplate<br/>Detailed Instructions]
    STRATEGY -->|UnifiedModel| UNIFIED_PROMPT[unifiedModelSystemPrompt<br/>Structured Output]
    STRATEGY -->|SimplifiedSystemPrompt| SIMPLE_PROMPT[simplifiedPrompt<br/>Brief Instructions]
    STRATEGY -->|Xtab275| XTAB275_PROMPT[xtab275SystemPrompt<br/>Concise Instructions]
    
    SYSTEM_TEMPLATE --> TAGS[Uses CODE_TO_EDIT tags]
    UNIFIED_PROMPT --> STRUCTURED[Uses EDIT/INSERT/NO_CHANGE]
    SIMPLE_PROMPT --> MINIMAL[Minimal context]
    XTAB275_PROMPT --> BRIEF[Brief context]
```

Sources: [src/extension/xtab/common/promptCrafting.ts:34-102](), [src/extension/xtab/node/xtabProvider.ts:217-248]()

## Diagnostics-Based Edit Providers

Diagnostics-based providers generate code completions by analyzing VS Code diagnostics (errors, warnings) and providing appropriate fixes through code actions.

### Provider Hierarchy

```mermaid
graph TB
    subgraph "Diagnostics Providers"
        IMPORT_PROV[ImportDiagnosticCompletionProvider<br/>Missing Import Fixes]
        ASYNC_PROV[AsyncDiagnosticCompletionProvider<br/>Missing Async Fixes]
        ANY_PROV[AnyDiagnosticCompletionProvider<br/>Generic Code Actions]
    end
    
    subgraph "Common Interface"
        IDIAG_INTERFACE[IDiagnosticCompletionProvider]
        PROVIDE_METHOD["provideDiagnosticCompletionItem()"]
        VALIDITY_METHOD["isCompletionItemStillValid()"]
    end
    
    subgraph "Completion Items"
        IMPORT_ITEM[ImportDiagnosticCompletionItem]
        ASYNC_ITEM[AsyncDiagnosticCompletionItem]
        ANY_ITEM[AnyDiagnosticCompletionItem]
    end
    
    IMPORT_PROV --> IDIAG_INTERFACE
    ASYNC_PROV --> IDIAG_INTERFACE
    ANY_PROV --> IDIAG_INTERFACE
    
    IDIAG_INTERFACE --> PROVIDE_METHOD
    IDIAG_INTERFACE --> VALIDITY_METHOD
    
    IMPORT_PROV --> IMPORT_ITEM
    ASYNC_PROV --> ASYNC_ITEM
    ANY_PROV --> ANY_ITEM
```

Sources: [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/diagnosticsCompletions.ts:109-115](), [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/importDiagnosticsCompletionProvider.ts:179-206](), [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/asyncDiagnosticsCompletionProvider.ts:27-33]()

### Import Diagnostics Provider

The `ImportDiagnosticCompletionProvider` specializes in resolving missing import statements by analyzing "Cannot find name" diagnostics and suggesting appropriate imports.

#### Language Support and Import Detection

```mermaid
graph LR
    subgraph "Supported Languages"
        TS[TypeScript]
        JS[JavaScript]
        TSX[TypeScriptReact]
        JSX[JavaScriptReact]
        PY[Python]
    end
    
    subgraph "Import Handlers"
        JS_HANDLER[JavascriptImportHandler]
        PY_HANDLER[PythonImportHandler]
    end
    
    subgraph "Import Classification"
        LOCAL[Local Imports<br/>./relative paths]
        EXTERNAL[External Imports<br/>node_modules]
        UNKNOWN[Unknown Source]
    end
    
    TS --> JS_HANDLER
    JS --> JS_HANDLER
    TSX --> JS_HANDLER
    JSX --> JS_HANDLER
    PY --> PY_HANDLER
    
    JS_HANDLER --> LOCAL
    JS_HANDLER --> EXTERNAL
    JS_HANDLER --> UNKNOWN
    
    PY_HANDLER --> LOCAL
    PY_HANDLER --> UNKNOWN
```

Sources: [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/importDiagnosticsCompletionProvider.ts:181-206](), [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/importDiagnosticsCompletionProvider.ts:368-445]()

### Async Diagnostics Provider

The `AsyncDiagnosticCompletionProvider` handles TypeScript error code 1308, which indicates missing `async` keywords in function declarations.

#### Async Code Action Processing

```mermaid
graph TD
    DIAGNOSTIC["Diagnostic Code 1308<br/>Missing await operator"]
    
    DIAGNOSTIC --> FETCH_ACTIONS["getCodeActionsForDiagnostic()"]
    FETCH_ACTIONS --> FILTER_ASYNC["Filter by Title Prefixes:<br/>- 'Add async'<br/>- 'Update async'"]
    FILTER_ASYNC --> CREATE_ITEM["Create AsyncDiagnosticCompletionItem"]
    CREATE_ITEM --> APPLY_EDIT["Apply TextReplacement Edit"]
```

Sources: [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/asyncDiagnosticsCompletionProvider.ts:75-106]()

## Configuration System

Edit providers are extensively configurable through the `IConfigurationService`, with settings controlling behavior, performance, and experimentation.

### XtabProvider Configuration

| Setting | Purpose | Default |
|---|---|---|
| `InlineEditsXtabProviderUrl` | Override model endpoint | `undefined` |
| `InlineEditsXtabProviderModelName` | Override model name | `undefined` |
| `InlineEditsXtabNRecentlyViewedDocuments` | Context document count | `5` |
| `InlineEditsXtabCurrentFileMaxTokens` | Current file token limit | `2000` |
| `InlineEditsXtabLanguageContextEnabled` | Enable AST context | `false` |
| `InlineEditsXtabUseUnifiedModel` | Use structured output | `false` |

Sources: [src/platform/configuration/common/configurationService.ts:655-682]()

### Diagnostics Configuration

| Setting | Purpose | Default |
|---|---|---|
| `InlineEditsDiagnosticsExplorationEnabled` | Enable generic diagnostics provider | `false` |
| `InlineEditsIgnoreCompletionsDisablement` | Ignore completions disabled state | `false` |
| `InlineEditsDebounce` | Debounce delay in milliseconds | `200` |

Sources: [src/platform/configuration/common/configurationService.ts:683-684](), [src/platform/configuration/common/configurationService.ts:640-647]()

## Request Processing Flow

The edit provider system processes requests through a sophisticated pipeline involving debouncing, context gathering, and result streaming.

### XtabProvider Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant XtabProvider
    participant Delayer
    participant ContextService
    participant Endpoint
    participant ResponseProcessor
    
    Client->>XtabProvider: provideNextEditBase()
    XtabProvider->>Delayer: createDelaySession()
    XtabProvider->>ContextService: getLanguageContext()
    XtabProvider->>XtabProvider: buildPrompt()
    XtabProvider->>Delayer: debounce()
    XtabProvider->>Endpoint: makeChatRequest()
    Endpoint-->>XtabProvider: streaming response
    XtabProvider->>ResponseProcessor: diff()
    ResponseProcessor-->>Client: LineEdit results
```

Sources: [src/extension/xtab/node/xtabProvider.ts:110-137](), [src/extension/xtab/node/xtabProvider.ts:391-500]()

### Diagnostics Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant DiagnosticsProcessor
    participant LanguageDiagnostics
    participant Provider
    participant VSCodeAPI
    
    Client->>DiagnosticsProcessor: getCurrentState()
    DiagnosticsProcessor->>LanguageDiagnostics: getDiagnostics()
    DiagnosticsProcessor->>Provider: provideDiagnosticCompletionItem()
    Provider->>VSCodeAPI: executeCodeActionProvider()
    VSCodeAPI-->>Provider: CodeAction[]
    Provider->>Provider: createCompletionItem()
    Provider-->>DiagnosticsProcessor: DiagnosticCompletionItem
    DiagnosticsProcessor-->>Client: DiagnosticCompletionState
```

Sources: [src/extension/inlineEdits/vscode-node/features/diagnosticsCompletionProcessor.ts:286-308](), [src/extension/inlineEdits/vscode-node/features/diagnosticsBasedCompletions/diagnosticsCompletions.ts:160-184]()

## Performance and Caching

Edit providers implement sophisticated caching and performance optimization strategies:

### Debouncing Strategy

The `Delayer` class implements adaptive debouncing based on user behavior:

```mermaid
graph TD
    TRIGGER[Edit Trigger]
    DEBOUNCE{Debounce Period}
    
    TRIGGER --> DEBOUNCE
    DEBOUNCE -->|Base: 200ms| EXTRA_DEBOUNCE{End of Line?}
    EXTRA_DEBOUNCE -->|Yes| EXTENDED["+configurable ms"]
    EXTRA_DEBOUNCE -->|No| NORMAL[Normal debounce]
    
    EXTENDED --> BACKOFF{Backoff Enabled?}
    NORMAL --> BACKOFF
    BACKOFF -->|Yes| ADAPTIVE[Adaptive timing]
    BACKOFF -->|No| FIXED[Fixed timing]
```

Sources: [src/extension/xtab/node/xtabProvider.ts:177-178](), [src/platform/configuration/common/configurationService.ts:647-650]()

### Diagnostics Caching

The `DiagnosticsCollection` class efficiently tracks and invalidates cached diagnostics:

```mermaid
graph TD
    EDIT_EVENT[Document Edit]
    EDIT_EVENT --> APPLY_EDIT["applyEdit()"]
    
    APPLY_EDIT --> RANGE_CHECK{Range Changed?}
    RANGE_CHECK -->|Shrunk| INVALIDATE[Invalidate Diagnostic]
    RANGE_CHECK -->|Same Size| CONTENT_CHECK{Content Same?}
    RANGE_CHECK -->|Grew| GROWTH_CHECK{Prefix/Suffix Match?}
    
    CONTENT_CHECK -->|Yes| UPDATE_RANGE[Update Range]
    CONTENT_CHECK -->|No| INVALIDATE
    
    GROWTH_CHECK -->|Yes| EDGE_CHECK{Edge Alphanumeric?}
    GROWTH_CHECK -->|No| INVALIDATE
    
    EDGE_CHECK -->|Yes| INVALIDATE
    EDGE_CHECK -->|No| UPDATE_RANGE
```

Sources: [src/extension/inlineEdits/vscode-node/features/diagnosticsCompletionProcessor.ts:56-164]()

## Telemetry and Observability

Edit providers include comprehensive telemetry for performance monitoring and debugging:

### Telemetry Data Points

| Metric | Provider | Purpose |
|---|---|---|
| `ttft` | XtabProvider | Time to first token |
| `modelName` | XtabProvider | Model identifier |
| `nLinesOfCurrentFileInPrompt` | XtabProvider | Context size |
| `type` | Diagnostics | Completion type |
| `droppedReasons` | Diagnostics | Why completions were rejected |
| `distanceToUnknownDiagnostic` | Diagnostics | Proximity to unsupported issues |

Sources: [src/extension/xtab/node/xtabProvider.ts:427-464](), [src/extension/inlineEdits/vscode-node/features/diagnosticsCompletionProcessor.ts:342-371]()