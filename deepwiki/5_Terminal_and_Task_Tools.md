# Terminal and Task Tools

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [src/extension/prompts/node/agent/test/terminalAndTaskPrompt.spec.tsx](src/extension/prompts/node/agent/test/terminalAndTaskPrompt.spec.tsx)
- [src/extension/tools/node/getTaskOutputTool.tsx](src/extension/tools/node/getTaskOutputTool.tsx)
- [src/extension/tools/node/runInTerminalTool.tsx](src/extension/tools/node/runInTerminalTool.tsx)
- [src/extension/tools/node/runTaskTool.tsx](src/extension/tools/node/runTaskTool.tsx)
- [src/extension/tools/node/test/runInTerminalTool.spec.tsx](src/extension/tools/node/test/runInTerminalTool.spec.tsx)
- [src/extension/tools/node/test/toolUtils.terminal.spec.ts](src/extension/tools/node/test/toolUtils.terminal.spec.ts)
- [src/extension/tools/node/toolUtils.terminal.ts](src/extension/tools/node/toolUtils.terminal.ts)
- [src/platform/tasks/common/tasksService.ts](src/platform/tasks/common/tasksService.ts)
- [src/platform/tasks/common/testTasksService.ts](src/platform/tasks/common/testTasksService.ts)
- [src/platform/tasks/vscode/tasksService.ts](src/platform/tasks/vscode/tasksService.ts)

</details>



This section covers the terminal command execution and VS Code task management capabilities within the GitHub Copilot Chat extension. The system provides language model tools that can execute commands in terminals, run VS Code tasks, and retrieve their output. It includes sophisticated command auto-approval mechanisms, multiple terminal execution strategies, and comprehensive output handling.

For information about other language model tools like code modification and search, see [Code Modification Tools](#3.3). For details on the overall tool registry and orchestration, see [Chat Participants and Language Model Tools](#3).

## Tool Architecture Overview

The terminal and task tools form a cohesive system that bridges AI language models with VS Code's terminal and task execution capabilities.

```mermaid
graph TB
    subgraph "Language Model Tools"
        RunTaskTool["RunTaskTool"]
        RunInTerminalTool["RunInTerminalTool"]
        GetTaskOutputTool["GetTaskOutputTool"]
        GetTerminalOutputTool["GetTerminalOutputTool"]
    end
    
    subgraph "Core Services"
        TasksService["TasksService"]
        TerminalService["TerminalService"]
        ConfigurationService["ConfigurationService"]
    end
    
    subgraph "Execution Strategies"
        RichIntegrationTerminalExecuteStrategy["RichIntegrationTerminalExecuteStrategy"]
        BasicIntegrationTerminalExecuteStrategy["BasicIntegrationTerminalExecuteStrategy"]
        NoIntegrationTerminalExecuteStrategy["NoIntegrationTerminalExecuteStrategy"]
    end
    
    subgraph "Auto-Approval System"
        CommandLineAutoApprover["CommandLineAutoApprover"]
        TerminalAllowList["TerminalAllowList Config"]
        TerminalDenyList["TerminalDenyList Config"]
    end
    
    RunTaskTool --> TasksService
    RunInTerminalTool --> TerminalService
    GetTaskOutputTool --> TasksService
    GetTerminalOutputTool --> RunInTerminalTool
    
    RunInTerminalTool --> RichIntegrationTerminalExecuteStrategy
    RunInTerminalTool --> BasicIntegrationTerminalExecuteStrategy
    RunInTerminalTool --> NoIntegrationTerminalExecuteStrategy
    
    RunInTerminalTool --> CommandLineAutoApprover
    CommandLineAutoApprover --> TerminalAllowList
    CommandLineAutoApprover --> TerminalDenyList
    CommandLineAutoApprover --> ConfigurationService
```

Sources: [src/extension/tools/node/runTaskTool.tsx:27-39](), [src/extension/tools/node/runInTerminalTool.tsx:36-66](), [src/extension/tools/node/getTaskOutputTool.tsx:26-35](), [src/extension/tools/node/toolUtils.terminal.ts:571-648]()

## Task Execution System

The task execution system provides tools for running and monitoring VS Code tasks through the language model interface.

### RunTaskTool Implementation

```mermaid
graph TB
    subgraph "RunTaskTool Flow"
        ToolInvocation["Tool Invocation"]
        getTaskDefinition["getTaskDefinition()"]
        TasksService_executeTask["TasksService.executeTask()"]
        BufferPolling["Terminal Buffer Polling"]
        OutputEvaluation["_evaluateOutputForErrors()"]
        ToolResult["LanguageModelToolResult"]
    end
    
    subgraph "Task Monitoring"
        TaskStatus["TaskStatus enum"]
        TaskResult["TaskResult interface"]
        TerminalBuffer["Terminal Buffer"]
        ErrorEvaluation["AI Error Evaluation"]
    end
    
    ToolInvocation --> getTaskDefinition
    getTaskDefinition --> TasksService_executeTask
    TasksService_executeTask --> BufferPolling
    BufferPolling --> OutputEvaluation
    OutputEvaluation --> ToolResult
    
    TasksService_executeTask --> TaskStatus
    TaskStatus --> TaskResult
    BufferPolling --> TerminalBuffer
    OutputEvaluation --> ErrorEvaluation
```

The `RunTaskTool` class executes VS Code tasks and monitors their output through a sophisticated polling mechanism:

| Component | Purpose | Key Methods |
|-----------|---------|-------------|
| `getTaskDefinition()` | Parses task ID and resolves task | [src/extension/tools/node/runTaskTool.tsx:192-209]() |
| `executeTask()` | Executes task via TasksService | [src/platform/tasks/vscode/tasksService.ts:206-305]() |
| `_evaluateOutputForErrors()` | Uses AI to evaluate terminal output | [src/extension/tools/node/runTaskTool.tsx:137-151]() |
| Buffer polling | Monitors terminal output changes | [src/extension/tools/node/runTaskTool.tsx:66-110]() |

Sources: [src/extension/tools/node/runTaskTool.tsx:41-135](), [src/platform/tasks/vscode/tasksService.ts:206-305]()

### Task Service Architecture

```mermaid
graph TB
    subgraph "TasksService Core"
        latestTerminalForTaskDefinition["latestTerminalForTaskDefinition Map"]
        executeTask["executeTask()"]
        getTerminalForTask["getTerminalForTask()"]
        isTaskActive["isTaskActive()"]
    end
    
    subgraph "VS Code Task API"
        vscode_tasks["vscode.tasks"]
        TaskExecution["TaskExecution"]
        TaskDefinition["TaskDefinition"]
        Terminal["Terminal"]
    end
    
    subgraph "Task Configuration"
        tasks_json["tasks.json"]
        getTasksFromConfig["getTasksFromConfig()"]
        ensureTask["ensureTask()"]
    end
    
    executeTask --> vscode_tasks
    vscode_tasks --> TaskExecution
    TaskExecution --> Terminal
    Terminal --> latestTerminalForTaskDefinition
    
    getTerminalForTask --> latestTerminalForTaskDefinition
    isTaskActive --> vscode_tasks
    
    getTasksFromConfig --> tasks_json
    ensureTask --> tasks_json
```

The `TasksService` manages the lifecycle of VS Code tasks and maintains mappings between task definitions and their associated terminals.

Sources: [src/platform/tasks/vscode/tasksService.ts:23-306](), [src/platform/tasks/common/tasksService.ts:24-71]()

## Terminal Execution System

The terminal execution system provides multiple strategies for running commands based on shell integration capabilities.

### Execution Strategy Selection

```mermaid
graph LR
    subgraph "Strategy Selection"
        ShellIntegrationQuality["ShellIntegrationQuality enum"]
        Rich["Rich Integration"]
        Basic["Basic Integration"]
        None["No Integration"]
    end
    
    subgraph "Execution Strategies"
        RichIntegrationTerminalExecuteStrategy["RichIntegrationTerminalExecuteStrategy"]
        BasicIntegrationTerminalExecuteStrategy["BasicIntegrationTerminalExecuteStrategy"]
        NoIntegrationTerminalExecuteStrategy["NoIntegrationTerminalExecuteStrategy"]
    end
    
    ShellIntegrationQuality --> Rich
    ShellIntegrationQuality --> Basic
    ShellIntegrationQuality --> None
    
    Rich --> RichIntegrationTerminalExecuteStrategy
    Basic --> BasicIntegrationTerminalExecuteStrategy
    None --> NoIntegrationTerminalExecuteStrategy
```

### Terminal Execution Strategies

| Strategy | Shell Integration | Command Execution | Output Reliability |
|----------|------------------|-------------------|-------------------|
| `RichIntegrationTerminalExecuteStrategy` | Full with command detection | `shellIntegration.executeCommand()` | High - exact sequences |
| `BasicIntegrationTerminalExecuteStrategy` | Basic without command detection | `shellIntegration.executeCommand()` | Medium - polling required |
| `NoIntegrationTerminalExecuteStrategy` | None | `terminal.sendText()` | Low - timing based |

Each strategy implements the `ITerminalExecuteStrategy` interface with different approaches to command execution and output collection.

Sources: [src/extension/tools/node/toolUtils.terminal.ts:140-394](), [src/extension/tools/node/runInTerminalTool.tsx:156-206]()

### Rich Integration Strategy

```mermaid
sequenceDiagram
    participant Tool as "RunInTerminalTool"
    participant Strategy as "RichIntegrationTerminalExecuteStrategy"
    participant SI as "ShellIntegration"
    participant Terminal as "Terminal"
    
    Tool->>Strategy: execute(commandLine)
    Strategy->>SI: executeCommand(commandLine)
    SI->>Terminal: Execute command
    
    loop Data Stream Reading
        SI->>Strategy: Stream data chunks
        Strategy->>Strategy: Accumulate result
    end
    
    Strategy->>Strategy: Wait for end event
    Strategy->>Tool: Return sanitized result
```

The rich integration strategy leverages VS Code's shell integration API to get precise command execution tracking and reliable output collection.

Sources: [src/extension/tools/node/toolUtils.terminal.ts:156-249]()

## Command Auto-Approval System

The command auto-approval system provides configurable allow/deny lists for terminal commands to reduce confirmation prompts for safe operations.

### Auto-Approval Architecture

```mermaid
graph TB
    subgraph "CommandLineAutoApprover"
        allowListRegexes["_allowListRegexes: RegExp[]"]
        denyListRegexes["_denyListRegexes: RegExp[]"]
        isAutoApproved["isAutoApproved()"]
        commandMatchesRegex["commandMatchesRegex()"]
    end
    
    subgraph "Configuration"
        TerminalAllowList["ConfigKey.TerminalAllowList"]
        TerminalDenyList["ConfigKey.TerminalDenyList"]
        ConfigurationService["ConfigurationService"]
    end
    
    subgraph "Command Processing"
        splitCommandLineIntoSubCommands["splitCommandLineIntoSubCommands()"]
        extractInlineSubCommands["extractInlineSubCommands()"]
        SubCommands["Sub-commands"]
    end
    
    ConfigurationService --> TerminalAllowList
    ConfigurationService --> TerminalDenyList
    TerminalAllowList --> allowListRegexes
    TerminalDenyList --> denyListRegexes
    
    isAutoApproved --> commandMatchesRegex
    commandMatchesRegex --> allowListRegexes
    commandMatchesRegex --> denyListRegexes
    
    isAutoApproved --> splitCommandLineIntoSubCommands
    splitCommandLineIntoSubCommands --> extractInlineSubCommands
    extractInlineSubCommands --> SubCommands
```

### Command Line Parsing

The system parses complex command lines to extract all sub-commands for individual approval:

| Function | Purpose | Shell Support |
|----------|---------|---------------|
| `splitCommandLineIntoSubCommands()` | Splits on operators like `&&`, `||`, `|` | sh, zsh, pwsh |
| `extractInlineSubCommands()` | Extracts `$(...)`, backticks, `<(...)` | sh, zsh, pwsh |
| `isPowerShell()` | Detects PowerShell variants | All platforms |

The approval logic follows this precedence:
1. **Deny list** - Commands matching deny patterns are blocked
2. **Allow list** - Commands matching allow patterns are approved
3. **Default** - All other commands require confirmation

Sources: [src/extension/tools/node/toolUtils.terminal.ts:571-648](), [src/extension/tools/node/toolUtils.terminal.ts:659-810]()

## Output Handling and Sanitization

The system provides comprehensive output handling with sanitization and length limits to prevent context overflow.

### Output Sanitization Pipeline

```mermaid
graph LR
    subgraph "Raw Output"
        TerminalBuffer["Terminal Buffer"]
        AnsiEscapeCodes["ANSI Escape Codes"]
        RawText["Raw Text"]
    end
    
    subgraph "Sanitization"
        removeAnsiEscapeCodes["removeAnsiEscapeCodes()"]
        sanitizeTerminalOutput["sanitizeTerminalOutput()"]
        TruncationLogic["Truncation Logic"]
    end
    
    subgraph "Clean Output"
        CleanText["Clean Text"]
        TruncatedOutput["Truncated Output"]
        LanguageModelTextPart["LanguageModelTextPart"]
    end
    
    TerminalBuffer --> AnsiEscapeCodes
    AnsiEscapeCodes --> removeAnsiEscapeCodes
    removeAnsiEscapeCodes --> sanitizeTerminalOutput
    sanitizeTerminalOutput --> TruncationLogic
    TruncationLogic --> CleanText
    CleanText --> LanguageModelTextPart
```

The `sanitizeTerminalOutput()` function implements intelligent truncation:
- **Maximum length**: 60KB to prevent context overflow
- **Truncation strategy**: Keep 40% from start, 60% from end
- **Truncation message**: Clear indication of removed content

### Background Terminal Management

```mermaid
graph TB
    subgraph "Background Execution"
        BackgroundTerminalExecution["BackgroundTerminalExecution"]
        TerminalShellExecution["TerminalShellExecution"]
        AsyncDataStream["Async Data Stream"]
        OutputAccumulation["Output Accumulation"]
    end
    
    subgraph "Output Retrieval"
        GetTerminalOutputTool["GetTerminalOutputTool"]
        getBackgroundOutput["getBackgroundOutput()"]
        executions["executions Map"]
    end
    
    BackgroundTerminalExecution --> TerminalShellExecution
    TerminalShellExecution --> AsyncDataStream
    AsyncDataStream --> OutputAccumulation
    
    GetTerminalOutputTool --> getBackgroundOutput
    getBackgroundOutput --> executions
    executions --> BackgroundTerminalExecution
```

Background terminals maintain persistent output collection through the `BackgroundTerminalExecution` class, allowing retrieval of long-running command output.

Sources: [src/extension/tools/node/runInTerminalTool.tsx:412-461](), [src/extension/tools/node/runInTerminalTool.tsx:394-410]()

## Integration with VS Code

The terminal and task tools integrate deeply with VS Code's terminal and task systems through several key interfaces:

### Terminal Integration Points

| Integration | Purpose | Implementation |
|-------------|---------|----------------|
| `vscode.Terminal` | Terminal instance management | [src/extension/tools/node/toolUtils.terminal.ts:76-87]() |
| `vscode.TerminalShellIntegration` | Shell integration API | [src/extension/tools/node/toolUtils.terminal.ts:89-137]() |
| `vscode.tasks` | Task execution API | [src/platform/tasks/vscode/tasksService.ts:34-56]() |
| `PreparedTerminalToolInvocation` | Terminal tool preparation | [src/extension/tools/node/runInTerminalTool.tsx:267-305]() |

The system provides seamless integration with VS Code's existing terminal and task infrastructure while adding AI-powered command execution and monitoring capabilities.

Sources: [src/extension/tools/node/runInTerminalTool.tsx:267-305](), [src/platform/tasks/vscode/tasksService.ts:23-306](), [src/extension/tools/node/toolUtils.terminal.ts:36-138]()