# Testing

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [docs/media/debug-view.png](docs/media/debug-view.png)
- [docs/media/expandable-tool-result.png](docs/media/expandable-tool-result.png)
- [docs/media/file-widget.png](docs/media/file-widget.png)
- [docs/media/tool-log.png](docs/media/tool-log.png)
- [docs/tools.md](docs/tools.md)
- [src/extension/prompt/vscode-node/requestLoggerImpl.ts](src/extension/prompt/vscode-node/requestLoggerImpl.ts)

</details>



## Purpose and Scope

This document covers the testing framework and quality assurance processes for the GitHub Copilot Chat VS Code extension. The testing system includes unit tests, integration tests, simulation tests, and debugging tools to ensure the extension works correctly across different VS Code runtime environments.

For information about the build system that compiles the extension, see [Build System](10). For details about development environment setup, see [Development Environment](9).

## Testing Framework Overview

The extension employs a three-tier testing approach that validates functionality across different runtime environments and integration points.

### Testing Architecture

```mermaid
graph TB
    subgraph "Test Types"
        UT["Unit Tests"]
        ET["Extension Tests"]
        ST["Simulation Tests"]
    end

    subgraph "Test Commands"
        UTC["npm run test:unit"]
        ETC["npm run test:extension"]
        STC["npm run simulate"]
    end

    subgraph "Runtime Environments"
        NODE["Node.js Runtime"]
        VSCODE["VS Code Host"]
        LLM["LLM API Environment"]
    end

    subgraph "Support Systems"
        RL["RequestLogger"]
        DEBUG["Debug View"]
        CACHE["Simulation Cache"]
    end

    UT --> UTC
    ET --> ETC
    ST --> STC

    UTC --> NODE
    ETC --> VSCODE
    STC --> LLM

    VSCODE --> RL
    RL --> DEBUG
    STC --> CACHE
```

Sources: [CONTRIBUTING.md:83-121]()

## Unit Testing

Unit tests run in Node.js and validate individual components and utilities in isolation.

### Unit Test Execution

```mermaid
graph LR
    subgraph "Test Command"
        UTC["npm run test:unit"]
        NODE["Node.js Runtime"]
    end

    subgraph "Test Categories"
        UTIL["Utility Functions"]
        PLATFORM["Platform Services"]
        COMMON["Common Components"]
    end

    subgraph "Test Structure"
        SPEC["*.spec.ts files"]
        FIXTURES["Test Fixtures"]
        MOCKS["Mock Objects"]
    end

    UTC --> NODE
    NODE --> UTIL
    NODE --> PLATFORM
    NODE --> COMMON

    UTIL --> SPEC
    PLATFORM --> SPEC
    COMMON --> SPEC
    SPEC --> FIXTURES
    SPEC --> MOCKS
```

Unit tests focus on testing core functionality without requiring VS Code APIs or external dependencies. They validate utility functions, data structures, and business logic components.

Sources: [CONTRIBUTING.md:86-90]()

## Simulation Testing

Simulation tests interact with real Copilot API endpoints and LLMs to validate the extension's behavior in realistic scenarios.

### Simulation Test Architecture

```mermaid
graph TD
    subgraph "Simulation Commands"
        SIM["npm run simulate"]
        REQUIRE["npm run simulate-require-cache"]
        UPDATE["npm run simulate-update-baseline"]
    end

    subgraph "Test Execution"
        LLM["LLM API Calls"]
        RUNS["10 Runs Per Test"]
        RESULTS["Aggregate Results"]
    end

    subgraph "Caching System"
        CACHE_DIR["test/simulation/cache/"]
        LAYERS["cache/layers/"]
        BASELINE["baseline.json"]
    end

    subgraph "Quality Control"
        STOCHASTIC["Handle LLM Variability"]
        SNAPSHOT["Snapshot Testing"]
        DETERMINISTIC["Deterministic Results"]
    end

    SIM --> LLM
    LLM --> RUNS
    RUNS --> RESULTS
    RESULTS --> BASELINE

    REQUIRE --> CACHE_DIR
    CACHE_DIR --> LAYERS
    LAYERS --> DETERMINISTIC

    UPDATE --> BASELINE
    BASELINE --> SNAPSHOT
    SNAPSHOT --> STOCHASTIC
```

Each simulation test runs 10 times to accommodate the stochastic nature of LLMs, with results cached in `test/simulation/cache` for reproducibility.

Sources: [CONTRIBUTING.md:98-121]()

## Extension Testing

Extension tests run within an actual VS Code environment to validate end-to-end functionality and VS Code API integration.

### Extension Test Environment

```mermaid
graph LR
    subgraph "Test Execution"
        ETC["npm run test:extension"]
        VSCODE["VS Code Host"]
    end

    subgraph "Test Components"
        CHAT["Chat Participants"]
        TOOLS["Language Model Tools"]
        CONTEXT["Context Providers"]
        INLINE["Inline Edits"]
    end

    subgraph "VS Code Integration"
        API["VS Code API"]
        LM["Language Model API"]
        WORKSPACE["Workspace API"]
        COMMANDS["Command API"]
    end

    ETC --> VSCODE
    VSCODE --> CHAT
    VSCODE --> TOOLS
    VSCODE --> CONTEXT
    VSCODE --> INLINE

    CHAT --> API
    TOOLS --> LM
    CONTEXT --> WORKSPACE
    INLINE --> COMMANDS
```

Extension tests validate the full integration with VS Code APIs, including chat participants, language model tools, context providers, and inline edit functionality.

Sources: [CONTRIBUTING.md:92-96]()

## Request Logging and Debugging

The extension includes comprehensive request logging and debugging tools to help with testing and troubleshooting.

### Request Logger System

```mermaid
graph TD
    subgraph "RequestLogger Implementation"
        LOGGER["RequestLogger"]
        ENTRIES["LoggedInfo[]"]
        SCHEMES["ChatRequestScheme"]
    end

    subgraph "Log Entry Types"
        REQUEST["LoggedRequest"]
        TOOL_CALL["LoggedToolCall"]
        ELEMENT["LoggedElement"]
    end

    subgraph "Debug Integration"
        DEBUG_VIEW["Show Chat Debug View"]
        MARKDOWN["Markdown Rendering"]
        LINKS["Document Links"]
    end

    subgraph "Content Providers"
        CONTENT_PROVIDER["TextDocumentContentProvider"]
        LINK_PROVIDER["DocumentLinkProvider"]
        URI_PARSING["URI Parsing"]
    end

    LOGGER --> ENTRIES
    ENTRIES --> REQUEST
    ENTRIES --> TOOL_CALL
    ENTRIES --> ELEMENT

    DEBUG_VIEW --> MARKDOWN
    MARKDOWN --> CONTENT_PROVIDER
    CONTENT_PROVIDER --> LINK_PROVIDER
    LINK_PROVIDER --> URI_PARSING
```

The `RequestLogger` class tracks all chat requests, tool calls, and prompt elements, providing a comprehensive debugging interface through VS Code's debug view.

Sources: [src/extension/prompt/vscode-node/requestLoggerImpl.ts:21-354](), [CONTRIBUTING.md:299-306]()

## Tool Testing

Language model tools require specialized testing approaches to validate their integration with the chat system.

### Tool Testing Strategy

```mermaid
graph LR
    subgraph "Tool Test Types"
        UNIT["Unit Tests"]
        SNAPSHOT["Snapshot Tests"]
        INTEGRATION["Integration Tests"]
    end

    subgraph "Test Components"
        SCHEMA["Input Schema Validation"]
        EXECUTION["Tool Execution"]
        RESULT["Result Formatting"]
    end

    subgraph "Testing Tools"
        SPEC["*.spec.tsx files"]
        HARDCODED["Hardcoded Arguments"]
        SNAPSHOT_MATCH["Snapshot Matching"]
    end

    UNIT --> SCHEMA
    SNAPSHOT --> EXECUTION
    INTEGRATION --> RESULT

    SCHEMA --> SPEC
    EXECUTION --> HARDCODED
    RESULT --> SNAPSHOT_MATCH
```

Tool tests validate input schemas, execution logic, and result formatting using snapshot testing to ensure consistent output.

### Tool Testing Guidelines

| Test Aspect | Approach | Purpose |
|-------------|----------|---------|
| Input Validation | Schema-based testing | Ensure proper parameter handling |
| Execution Logic | Hardcoded arguments | Validate core functionality |
| Result Formatting | Snapshot testing | Maintain consistent output |
| Error Handling | Exception testing | Verify proper error messages |

Sources: [docs/tools.md:68-77]()

## Debug View and Prompt Analysis

The extension provides debugging tools to analyze chat requests and prompt generation for testing purposes.

### Debug View System

```mermaid
graph TD
    subgraph "Debug Commands"
        DEBUG_CMD["Show Chat Debug View"]
        EXPORT["Export As..."]
        TREE_VIEW["TreeView Interface"]
    end

    subgraph "Debug Information"
        REQUEST_LOG["Request Log"]
        PROMPT_DETAILS["Prompt Details"]
        TOOL_CALLS["Tool Call History"]
        RESPONSE_DATA["Response Data"]
    end

    subgraph "Analysis Tools"
        PROMPT_RENDER["Prompt Rendering"]
        TOKEN_COUNT["Token Counting"]
        MODEL_INFO["Model Information"]
        TIMING["Request Timing"]
    end

    subgraph "Export Formats"
        MARKDOWN_EXPORT["Markdown Export"]
        JSON_EXPORT["JSON Export"]
        BROWSER_VIEW["Simple Browser View"]
    end

    DEBUG_CMD --> TREE_VIEW
    TREE_VIEW --> REQUEST_LOG
    REQUEST_LOG --> PROMPT_DETAILS
    REQUEST_LOG --> TOOL_CALLS
    REQUEST_LOG --> RESPONSE_DATA

    PROMPT_DETAILS --> PROMPT_RENDER
    PROMPT_DETAILS --> TOKEN_COUNT
    RESPONSE_DATA --> MODEL_INFO
    RESPONSE_DATA --> TIMING

    EXPORT --> MARKDOWN_EXPORT
    EXPORT --> JSON_EXPORT
    EXPORT --> BROWSER_VIEW
```

The debug view provides detailed information about chat requests, including prompts, tool calls, and response data, essential for testing and troubleshooting.

Sources: [CONTRIBUTING.md:299-306]()

## CI/CD Test Integration

The testing system is fully integrated into the CI/CD pipeline, providing comprehensive validation for all pull requests and main branch pushes.

### Test Execution in CI/CD

```mermaid
graph TD
    subgraph "Trigger Events"
        PR["Pull Request"]
        PUSH["Push to main"]
        QUEUE["Merge Queue"]
    end

    subgraph "Parallel Test Jobs"
        CACHE_JOB["check-test-cache"]
        TELEM_JOB["check-telemetry"]
        LINUX_JOB["linux-tests"]
        WINDOWS_JOB["windows-tests"]
    end

    subgraph "Test Dependencies"
        NODE_SETUP["Node.js 22.14.x"]
        PYTHON_SETUP["Python 3.12"]
        DOTNET_SETUP["dotnet CLI"]
        LFS["Git LFS"]
    end

    subgraph "Artifact Management"
        SIM_ARCHIVE["Simulation Archive"]
        CACHE_UPLOAD["Cache Upload"]
        ARTIFACT_UPLOAD["Artifact Upload"]
    end

    PR --> CACHE_JOB
    PR --> TELEM_JOB
    PR --> LINUX_JOB
    PR --> WINDOWS_JOB

    PUSH --> CACHE_JOB
    PUSH --> TELEM_JOB
    PUSH --> LINUX_JOB
    PUSH --> WINDOWS_JOB

    QUEUE --> CACHE_JOB
    QUEUE --> TELEM_JOB
    QUEUE --> LINUX_JOB
    QUEUE --> WINDOWS_JOB

    LINUX_JOB --> NODE_SETUP
    LINUX_JOB --> PYTHON_SETUP
    LINUX_JOB --> DOTNET_SETUP
    LINUX_JOB --> LFS

    WINDOWS_JOB --> NODE_SETUP
    WINDOWS_JOB --> PYTHON_SETUP
    WINDOWS_JOB --> LFS

    LINUX_JOB --> SIM_ARCHIVE
    SIM_ARCHIVE --> ARTIFACT_UPLOAD
    CACHE_JOB --> CACHE_UPLOAD
```

The CI/CD system runs tests in parallel across multiple jobs and platforms, with sophisticated caching and artifact management to optimize execution time.

Sources: [.github/workflows/pr.yml:1-217]()