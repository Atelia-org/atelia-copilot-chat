# Code Modification Tools

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [src/extension/byok/vscode-node/ollamaProvider.ts](src/extension/byok/vscode-node/ollamaProvider.ts)
- [src/extension/intents/node/agentIntent.ts](src/extension/intents/node/agentIntent.ts)
- [src/extension/prompt/node/indentationGuesser.ts](src/extension/prompt/node/indentationGuesser.ts)
- [src/extension/prompt/node/test/indentationGuesser.spec.ts](src/extension/prompt/node/test/indentationGuesser.spec.ts)
- [src/extension/tools/node/applyPatch/parser.ts](src/extension/tools/node/applyPatch/parser.ts)
- [src/extension/tools/node/applyPatchTool.tsx](src/extension/tools/node/applyPatchTool.tsx)
- [src/extension/tools/node/test/applyPatch.spec.ts](src/extension/tools/node/test/applyPatch.spec.ts)
- [src/extension/tools/test/node/applyPatch/parser.spec.ts](src/extension/tools/test/node/applyPatch/parser.spec.ts)
- [src/platform/endpoint/common/chatModelCapabilities.ts](src/platform/endpoint/common/chatModelCapabilities.ts)

</details>



This document covers the code modification tools system, which provides AI language models with the ability to edit files through structured patch operations. The primary tool is `apply_patch`, which allows models to make precise edits to source code files using a specialized diff format.

For information about inline edit suggestions, see [Inline Edits System](#4). For general chat participants and tool orchestration, see [Chat Participants and Language Model Tools](#3).

## Overview

The code modification tools system centers around the `ApplyPatchTool` class, which implements the `apply_patch` language model tool. This tool processes patch instructions from AI models and applies them to workspace files, handling both text files and Jupyter notebooks.

```mermaid
graph TD
    LLM["Language Model"] --> ApplyPatchTool["ApplyPatchTool"]
    ApplyPatchTool --> Parser["Parser"]
    Parser --> Commit["Commit"]
    Commit --> WorkspaceEdit["WorkspaceEdit"]
    WorkspaceEdit --> VSCode["VS Code Editor"]
    
    ApplyPatchTool --> NotebookSupport["Notebook Support"]
    NotebookSupport --> AlternativeNotebookContent["AlternativeNotebookContent"]
    
    ApplyPatchTool --> HealingSystem["Patch Healing"]
    HealingSystem --> GPT4OMINI["GPT-4o Mini"]
```

**Core Tool Architecture**

Sources: [src/extension/tools/node/applyPatchTool.tsx:81-101](), [src/extension/tools/node/applyPatch/parser.ts:164-179]()

## Patch Format and Processing Pipeline

The system uses a specialized patch format that differs from standard unified diff format. The `Parser` class handles the conversion from patch text to actionable file changes.

### Patch Format Structure

```mermaid
graph LR
    PatchText["*** Begin Patch<br/>*** Update File: path<br/>@@context<br/>-old line<br/>+new line<br/>*** End Patch"]
    Parser["Parser"]
    PatchAction["PatchAction"]
    Chunk["Chunk[]"]
    
    PatchText --> Parser
    Parser --> PatchAction
    PatchAction --> Chunk
    
    Chunk --> origIndex["origIndex: number"]
    Chunk --> delLines["delLines: string[]"]
    Chunk --> insLines["insLines: string[]"]
```

**Patch Processing Components**

| Component | Purpose | File Location |
|-----------|---------|---------------|
| `Parser` | Parses patch text into structured changes | [src/extension/tools/node/applyPatch/parser.ts:164-179]() |
| `PatchAction` | Represents file-level operations (ADD/DELETE/UPDATE) | [src/extension/tools/node/applyPatch/parser.ts:135-141]() |
| `Chunk` | Represents line-level changes within a file | [src/extension/tools/node/applyPatch/parser.ts:129-134]() |
| `Commit` | Final changeset ready for application | [src/extension/tools/node/applyPatch/parser.ts:62-64]() |

Sources: [src/extension/tools/node/applyPatch/parser.ts:49-64](), [src/extension/tools/node/applyPatch/parser.ts:129-145]()

### Context Matching and Fuzzy Logic

The parser implements sophisticated context matching with multiple fallback strategies:

```mermaid
graph TD
    Context["Context Lines"] --> Pass1["Pass 1: Exact Match"]
    Pass1 --> Pass2["Pass 2: Ignore Trailing Whitespace"]
    Pass2 --> Pass3["Pass 3: Normalize Explicit Tabs"]
    Pass3 --> Pass4["Pass 4: Normalize Explicit Newlines"]
    Pass4 --> Pass5["Pass 5: Ignore All Whitespace"]
    Pass5 --> Pass6["Pass 6: Edit Distance Matching"]
    
    Pass1 --> Match["Match Found"]
    Pass2 --> Match
    Pass3 --> Match
    Pass4 --> Match
    Pass5 --> Match
    Pass6 --> Match
    
    Pass6 --> Failure["No Match - InvalidContextError"]
```

**Context Matching Strategy**

Sources: [src/extension/tools/node/applyPatch/parser.ts:465-600](), [src/extension/tools/node/applyPatch/parser.ts:69-85]()

## Model Capabilities and Tool Selection

Different AI models support different code modification tools based on their capabilities:

```mermaid
graph TD
    ModelCheck["Model Detection"] --> GPT41["GPT-4.1"]
    ModelCheck --> Claude["Claude/Anthropic"]
    ModelCheck --> Gemini["Gemini"]
    ModelCheck --> Other["Other Models"]
    
    GPT41 --> ApplyPatch["apply_patch: true"]
    GPT41 --> ReplaceString1["replace_string: true"]
    GPT41 --> EditFile1["edit_file: true"]
    
    Claude --> ApplyPatch2["apply_patch: false"]
    Claude --> ReplaceString2["replace_string: true (exclusive)"]
    Claude --> EditFile2["edit_file: false"]
    
    Gemini --> ApplyPatch3["apply_patch: false"]
    Gemini --> ReplaceString3["replace_string: experimental"]
    Gemini --> EditFile3["edit_file: true"]
    
    Other --> ApplyPatch4["apply_patch: false"]
    Other --> ReplaceString4["replace_string: false"]
    Other --> EditFile4["edit_file: true"]
```

**Model Capability Detection**

| Function | Purpose | Models |
|----------|---------|---------|
| `modelSupportsApplyPatch` | Checks if model supports apply_patch tool | GPT-4.1, o4-mini |
| `modelSupportsReplaceString` | Checks if model supports replace_string tool | Claude, Anthropic |
| `modelCanUseReplaceStringExclusively` | Checks if model can use replace_string without edit_file | Claude, Anthropic |

Sources: [src/platform/endpoint/common/chatModelCapabilities.ts:28-45](), [src/extension/intents/node/agentIntent.ts:50-81]()

## Tool Integration and Invocation

The `ApplyPatchTool` integrates with the VS Code language model tools API and handles the complete patch application workflow:

```mermaid
graph TD
    ToolInvocation["LanguageModelToolInvocation"] --> ApplyPatchTool["ApplyPatchTool.invoke()"]
    ApplyPatchTool --> BuildCommit["buildCommitWithHealing()"]
    BuildCommit --> ProcessPatch["processPatch()"]
    ProcessPatch --> Parser["Parser.parse()"]
    Parser --> PatchToCommit["patch_to_commit()"]
    
    BuildCommit --> HealingCheck{"Healing Needed?"}
    HealingCheck --> HealCommit["healCommit()"]
    HealCommit --> GPT4OMini["GPT-4o Mini Request"]
    GPT4OMini --> RetryPatch["Retry with Healed Patch"]
    
    PatchToCommit --> WorkspaceEdit["WorkspaceEdit Generation"]
    WorkspaceEdit --> NotebookCheck{"Notebook File?"}
    NotebookCheck --> NotebookEdit["generateUpdateNotebookDocumentEdit()"]
    NotebookCheck --> TextEdit["generateUpdateTextDocumentEdit()"]
    
    NotebookEdit --> ResponseStream["ChatResponseStream"]
    TextEdit --> ResponseStream
    ResponseStream --> EditSurvival["Edit Survival Tracking"]
```

**Tool Workflow Components**

Sources: [src/extension/tools/node/applyPatchTool.tsx:209-425](), [src/extension/tools/node/applyPatchTool.tsx:473-528]()

## Error Handling and Patch Healing

The system implements automatic patch healing when initial application fails:

### Healing Process

```mermaid
graph TD
    PatchFail["Patch Application Failed"] --> ErrorType{"Error Type"}
    ErrorType --> InvalidContext["InvalidContextError"]
    ErrorType --> InvalidFormat["InvalidPatchFormatError"]
    ErrorType --> GenericError["Generic DiffError"]
    
    InvalidContext --> HealAttempt["Attempt Healing"]
    InvalidFormat --> HealAttempt
    GenericError --> HealAttempt
    
    HealAttempt --> HealPrompt["HealPatchPrompt"]
    HealPrompt --> GPT4OMini["GPT-4o Mini Request"]
    GPT4OMini --> HealedPatch["Healed Patch"]
    
    HealedPatch --> RetryParse["Retry Parse"]
    RetryParse --> Success["Success"]
    RetryParse --> HealFailed["Healing Failed"]
    
    HealFailed --> HealedError["HealedError with Original"]
    Success --> ApplyHealed["Apply Healed Patch"]
```

**Error Types and Handling**

| Error Type | Description | Telemetry Key |
|------------|-------------|---------------|
| `InvalidContextError` | Context lines not found in file | `invalidContext`, `invalidContext-eof` |
| `InvalidPatchFormatError` | Malformed patch syntax | `invalidPatchText`, `missingEndPatch` |
| `DiffError` | General patch processing error | `processPatchFailed` |

Sources: [src/extension/tools/node/applyPatch/parser.ts:146-158](), [src/extension/tools/node/applyPatchTool.tsx:439-511]()

## Indentation and Formatting

The system handles indentation normalization to ensure consistent code formatting:

```mermaid
graph TD
    PatchLines["Patch Insert Lines"] --> GuessSource["guessIndentation(sourceLines)"]
    TargetFile["Target File"] --> GuessTarget["guessIndentation(targetLines)"]
    
    GuessSource --> SrcIndent["Source Indentation Style"]
    GuessTarget --> TargetIndent["Target Indentation Style"]
    
    SrcIndent --> Transform["transformIndentation()"]
    TargetIndent --> Transform
    PatchLines --> Transform
    
    Transform --> NormalizedLines["Normalized Insert Lines"]
    NormalizedLines --> ApplyPatch["Apply to File"]
```

**Indentation Processing**

| Function | Purpose | Input | Output |
|----------|---------|-------|--------|
| `guessIndentation` | Analyzes file to determine indentation style | Text lines | `IGuessedIndentation` |
| `transformIndentation` | Converts between indentation styles | Content + source/target styles | Converted content |
| `replace_explicit_tabs` | Normalizes `\t` sequences to actual tabs | String with `\t` | String with tabs |

Sources: [src/extension/prompt/node/indentationGuesser.ts:134-257](), [src/extension/tools/node/applyPatch/parser.ts:457-463]()

## Notebook Support

The system provides specialized handling for Jupyter notebook files:

```mermaid
graph TD
    NotebookFile["Notebook File"] --> AlternativeContent["AlternativeNotebookContent"]
    AlternativeContent --> Format["getFormat(model)"]
    Format --> NotebookSnapshot["NotebookDocumentSnapshot"]
    
    NotebookSnapshot --> MultiFormat["Multi-format Content Generation"]
    MultiFormat --> Python["Python format"]
    MultiFormat --> XML["XML format"]
    MultiFormat --> JSON["JSON format"]
    MultiFormat --> Text["Text format"]
    
    Python --> SelectSmallest["Select Smallest Content"]
    XML --> SelectSmallest
    JSON --> SelectSmallest
    Text --> SelectSmallest
    
    SelectSmallest --> NotebookEditGenerator["AlternativeNotebookEditGenerator"]
    NotebookEditGenerator --> NotebookEdits["NotebookEdit[]"]
    NotebookEdits --> ResponseStream["ChatResponseStream"]
```

**Notebook Integration Components**

Sources: [src/extension/tools/node/applyPatchTool.tsx:163-207](), [src/extension/tools/node/applyPatchTool.tsx:289-304]()

## Telemetry and Monitoring

The system tracks various metrics for patch application success and edit survival:

| Telemetry Event | Purpose | Key Metrics |
|-----------------|---------|-------------|
| `applyPatchToolInvoked` | Track tool usage and outcomes | `outcome`, `model`, `healed`, `isNotebook` |
| `applyPatchHealRate` | Monitor healing success rate | `success` |
| `applyPatch.trackEditSurvival` | Track long-term edit retention | `survivalRateFourGram`, `survivalRateNoRevert` |

Sources: [src/extension/tools/node/applyPatchTool.tsx:531-567](), [src/extension/tools/node/applyPatchTool.tsx:500-510]()