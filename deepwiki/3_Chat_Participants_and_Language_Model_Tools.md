# Chat Participants and Language Model Tools

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [package-lock.json](package-lock.json)
- [package.json](package.json)
- [src/extension/prompts/node/agent/agentPrompt.tsx](src/extension/prompts/node/agent/agentPrompt.tsx)
- [src/extension/prompts/node/agent/test/terminalAndTaskPrompt.spec.tsx](src/extension/prompts/node/agent/test/terminalAndTaskPrompt.spec.tsx)
- [src/extension/prompts/node/base/terminalAndTaskState.tsx](src/extension/prompts/node/base/terminalAndTaskState.tsx)
- [src/extension/tools/node/getTaskOutputTool.tsx](src/extension/tools/node/getTaskOutputTool.tsx)
- [src/extension/tools/node/runTaskTool.tsx](src/extension/tools/node/runTaskTool.tsx)
- [src/platform/tasks/common/tasksService.ts](src/platform/tasks/common/tasksService.ts)
- [src/platform/tasks/common/testTasksService.ts](src/platform/tasks/common/testTasksService.ts)
- [src/platform/tasks/vscode/tasksService.ts](src/platform/tasks/vscode/tasksService.ts)
- [test/outcome/edit-toolcalling-panel.json](test/outcome/edit-toolcalling-panel.json)
- [test/outcome/fetchwebpagetool-toolcalling-panel.json](test/outcome/fetchwebpagetool-toolcalling-panel.json)
- [test/outcome/findfilestool-toolcalling-panel.json](test/outcome/findfilestool-toolcalling-panel.json)
- [test/outcome/notebooks-toolcalling-panel.json](test/outcome/notebooks-toolcalling-panel.json)
- [test/outcome/toolcalling-panel.json](test/outcome/toolcalling-panel.json)
- [test/simulation/baseline.json](test/simulation/baseline.json)

</details>



This document covers the core chat functionality of the GitHub Copilot Chat extension, including chat participants and the comprehensive language model tools system. It details how the extension provides AI-powered chat capabilities through multiple specialized participants and orchestrates over 60 language model tools for code analysis, editing, and workspace management.

For information about the inline edits system and edit providers, see [Inline Edits System](#4). For details about the AI agent prompt system and conversation history, see [Agent Prompt System](#3.1).

## Chat Participants Architecture

The extension implements multiple chat participants that handle different types of user interactions and contexts. Each participant specializes in specific domains and has access to relevant subsets of the language model tools.

```mermaid
graph TB
    subgraph "VS Code Chat Interface"
        USER["User Input"]
        CHAT_API["vscode.chat API"]
    end
    
    subgraph "Chat Participants"
        DEFAULT["Default Participant<br/>General chat queries"]
        AGENT["Agent Participant<br/>@copilot participant<br/>Autonomous actions"]
        WORKSPACE["Workspace Participant<br/>@workspace participant<br/>Codebase queries"]
        TERMINAL["Terminal Participant<br/>@terminal participant<br/>Command help"]
        EDITOR["Editor Participant<br/>Inline chat context"]
    end
    
    subgraph "Tool Selection & Execution"
        TOOL_REGISTRY["ToolRegistry<br/>src/extension/tools/common/toolsRegistry.ts"]
        TOOL_ORCHESTRATION["Tool Orchestration<br/>Model capability matching"]
        TOOL_INVOCATION["Tool Invocation<br/>VS Code API integration"]
    end
    
    USER --> CHAT_API
    CHAT_API --> DEFAULT
    CHAT_API --> AGENT
    CHAT_API --> WORKSPACE
    CHAT_API --> TERMINAL
    CHAT_API --> EDITOR
    
    DEFAULT --> TOOL_REGISTRY
    AGENT --> TOOL_REGISTRY
    WORKSPACE --> TOOL_REGISTRY
    TERMINAL --> TOOL_REGISTRY
    EDITOR --> TOOL_REGISTRY
    
    TOOL_REGISTRY --> TOOL_ORCHESTRATION
    TOOL_ORCHESTRATION --> TOOL_INVOCATION
```

Sources: [package.json:111-134](), [src/extension/prompts/node/agent/agentPrompt.tsx:1-50]()

## Language Model Tools Registry

The extension defines over 60 language model tools in its manifest, organized by functionality and integrated through a central registry system. Tools are registered using the `ToolRegistry.registerTool()` pattern and made available to language models through VS Code's language model tools API.

### Tool Categories and Organization

```mermaid
graph TB
    subgraph "Code Search & Analysis Tools"
        SEARCH_CODEBASE["copilot_searchCodebase<br/>toolReferenceName: codebase"]
        SEARCH_SYMBOLS["copilot_searchWorkspaceSymbols<br/>toolReferenceName: symbols"]
        LIST_USAGES["copilot_listCodeUsages<br/>toolReferenceName: usages"]
        FIND_FILES["copilot_findFiles<br/>toolReferenceName: fileSearch"]
        FIND_TEXT["copilot_findTextInFiles<br/>toolReferenceName: textSearch"]
        GET_ERRORS["copilot_getErrors<br/>toolReferenceName: problems"]
    end
    
    subgraph "File Manipulation Tools"
        READ_FILE["copilot_readFile<br/>toolReferenceName: readFile"]
        CREATE_FILE["copilot_createFile<br/>toolReferenceName: createFile"]
        APPLY_PATCH["copilot_applyPatch<br/>toolReferenceName: applyPatch"]
        REPLACE_STRING["copilot_replaceString<br/>toolReferenceName: replaceString"]
        INSERT_EDIT["copilot_insertEdit<br/>toolReferenceName: insertEdit"]
    end
    
    subgraph "Terminal & Execution Tools"
        RUN_TERMINAL["copilot_runInTerminal<br/>toolReferenceName: runInTerminal"]
        GET_TERMINAL_OUTPUT["copilot_getTerminalOutput<br/>toolReferenceName: getTerminalOutput"]
        TERMINAL_SELECTION["copilot_getTerminalSelection<br/>toolReferenceName: terminalSelection"]
        TERMINAL_LAST_CMD["copilot_getTerminalLastCommand<br/>toolReferenceName: terminalLastCommand"]
    end
    
    subgraph "Task Management Tools"
        RUN_TASK["copilot_runVsCodeTask<br/>toolReferenceName: runTask"]
        GET_TASK_OUTPUT["copilot_getTaskOutput<br/>toolReferenceName: getTaskOutput"]
        CREATE_RUN_TASK["copilot_createAndRunTask<br/>toolReferenceName: createAndRunTask"]
    end
    
    subgraph "Development Tools"
        RUN_TESTS["copilot_runTests<br/>toolReferenceName: runTests"]
        GET_CHANGES["copilot_getChangedFiles<br/>toolReferenceName: changes"]
        GET_VSCODE_API["copilot_getVSCodeAPI<br/>toolReferenceName: vscodeAPI"]
        TEST_FAILURE["copilot_testFailure<br/>toolReferenceName: testFailure"]
    end
```

Sources: [package.json:136-1043](), [src/extension/tools/common/toolsRegistry.ts]()

### Tool Registration and Lifecycle

Tools follow a consistent registration pattern where each tool class implements the `vscode.LanguageModelTool` interface and registers itself with the central registry:

```mermaid
graph LR
    subgraph "Tool Implementation"
        TOOL_CLASS["Tool Class<br/>implements vscode.LanguageModelTool"]
        INVOKE_METHOD["invoke(options, token)<br/>Core tool logic"]
        PREPARE_METHOD["prepareInvocation(options)<br/>User confirmation"]
    end
    
    subgraph "Registration System"
        TOOL_REGISTRY["ToolRegistry.registerTool()<br/>src/extension/tools/common/toolsRegistry.ts"]
        VS_CODE_API["vscode.lm.registerTool()<br/>VS Code Language Model API"]
    end
    
    subgraph "Tool Execution Flow"
        MODEL_REQUEST["Language Model<br/>Tool Selection"]
        TOOL_INVOCATION["Tool Invocation<br/>Parameter validation"]
        RESULT_PROCESSING["Result Processing<br/>LanguageModelToolResult"]
    end
    
    TOOL_CLASS --> INVOKE_METHOD
    TOOL_CLASS --> PREPARE_METHOD
    TOOL_CLASS --> TOOL_REGISTRY
    TOOL_REGISTRY --> VS_CODE_API
    
    MODEL_REQUEST --> TOOL_INVOCATION
    TOOL_INVOCATION --> INVOKE_METHOD
    INVOKE_METHOD --> RESULT_PROCESSING
```

Sources: [src/extension/tools/node/runTaskTool.tsx:212](), [src/extension/tools/node/getTaskOutputTool.tsx:92]()

## Terminal and Task Integration

The extension provides sophisticated integration with VS Code's terminal and task systems, enabling AI agents to execute commands, manage build processes, and monitor task output.

### Task Management Architecture

```mermaid
graph TB
    subgraph "VS Code Task System"
        TASK_DEFINITIONS["TaskDefinition[]<br/>from .vscode/tasks.json"]
        TASK_EXECUTIONS["vscode.tasks.taskExecutions<br/>Active task instances"]
        TASK_TERMINALS["Terminal instances<br/>Associated with tasks"]
    end
    
    subgraph "Copilot Task Services"
        TASKS_SERVICE["TasksService<br/>src/platform/tasks/vscode/tasksService.ts"]
        TERMINAL_SERVICE["TerminalService<br/>src/platform/terminal/"]
        TASK_TRACKING["latestTerminalForTaskDefinition<br/>Map<TaskDefinition, Terminal>"]
    end
    
    subgraph "Task Tools"
        RUN_TASK_TOOL["RunTaskTool<br/>src/extension/tools/node/runTaskTool.tsx"]
        GET_TASK_OUTPUT_TOOL["GetTaskOutputTool<br/>src/extension/tools/node/getTaskOutputTool.tsx"]
        CREATE_TASK_TOOL["CreateAndRunTaskTool<br/>copilot_createAndRunTask"]
    end
    
    subgraph "Terminal State Management"
        TERMINAL_STATE["TerminalAndTaskStatePromptElement<br/>src/extension/prompts/node/base/terminalAndTaskState.tsx"]
        COPILOT_TERMINALS["getCopilotTerminals()<br/>AI-managed terminals"]
        TERMINAL_COMMANDS["getLastCommandForTerminal()<br/>Command history"]
    end
    
    TASK_DEFINITIONS --> TASKS_SERVICE
    TASK_EXECUTIONS --> TASKS_SERVICE
    TASK_TERMINALS --> TASK_TRACKING
    
    TASKS_SERVICE --> RUN_TASK_TOOL
    TASKS_SERVICE --> GET_TASK_OUTPUT_TOOL
    TASKS_SERVICE --> CREATE_TASK_TOOL
    
    TERMINAL_SERVICE --> TERMINAL_STATE
    TERMINAL_SERVICE --> COPILOT_TERMINALS
    TERMINAL_SERVICE --> TERMINAL_COMMANDS
    
    RUN_TASK_TOOL --> TERMINAL_STATE
    TERMINAL_STATE --> COPILOT_TERMINALS
```

Sources: [src/platform/tasks/vscode/tasksService.ts:23-56](), [src/extension/prompts/node/base/terminalAndTaskState.tsx:18-109](), [src/extension/tools/node/runTaskTool.tsx:27-135]()

### Task Execution Flow

The task execution system provides comprehensive lifecycle management, from task definition matching to output evaluation:

```mermaid
sequenceDiagram
    participant Agent as "AI Agent"
    participant RunTaskTool as "RunTaskTool"
    participant TasksService as "TasksService"
    participant VSCodeTasks as "vscode.tasks"
    participant Terminal as "Terminal"
    participant OutputEval as "Output Evaluation"
    
    Agent->>RunTaskTool: invoke(taskId, workspaceFolder)
    RunTaskTool->>TasksService: getTaskDefinition(input)
    TasksService->>TasksService: getBestMatchingContributedTask(def)
    TasksService->>VSCodeTasks: executeTask(task)
    VSCodeTasks->>Terminal: Create/reuse terminal
    TasksService->>TasksService: Track terminal in latestTerminalForTaskDefinition
    
    loop Monitor Output
        RunTaskTool->>Terminal: getBufferForTerminal(terminal, 16000)
        RunTaskTool->>RunTaskTool: Check buffer idle/task inactive
        alt Buffer idle or task inactive
            RunTaskTool->>OutputEval: _evaluateOutputForErrors(buffer)
            OutputEval->>Agent: Evaluation result
        end
    end
    
    RunTaskTool->>Agent: LanguageModelToolResult
```

Sources: [src/extension/tools/node/runTaskTool.tsx:41-135](), [src/platform/tasks/vscode/tasksService.ts:206-305]()

## Tool Invocation and Result Processing

The extension implements a sophisticated tool invocation system that handles parameter validation, user confirmation, and result processing. Tools can be invoked directly by language models or referenced by users through the `toolReferenceName` system.

### Tool Invocation Architecture

```mermaid
graph TB
    subgraph "Language Model Integration"
        MODEL_REQUEST["Language Model<br/>Tool selection & parameters"]
        TOOL_SCHEMA["Tool Input Schema<br/>JSON Schema validation"]
        CAPABILITIES["Model Capabilities<br/>Tool availability checks"]
    end
    
    subgraph "Tool Invocation Pipeline"
        PREPARE_INVOCATION["prepareInvocation()<br/>User confirmation messages"]
        INVOKE_METHOD["invoke(options, token)<br/>Core tool execution"]
        RESULT_CONSTRUCTION["LanguageModelToolResult<br/>Response formatting"]
    end
    
    subgraph "Service Integration"
        WORKSPACE_SERVICE["IWorkspaceService<br/>Workspace folder resolution"]
        TERMINAL_SERVICE["ITerminalService<br/>Terminal management"]
        TASKS_SERVICE["ITasksService<br/>Task execution"]
        FILE_SYSTEM["IFileSystemService<br/>File operations"]
    end
    
    subgraph "User Interaction"
        CONFIRMATION["User Confirmation<br/>For non-build tasks"]
        TRUSTED_MARKDOWN["Trusted MarkdownString<br/>Clickable links"]
        PROGRESS_INDICATION["Progress Messages<br/>invocationMessage/pastTenseMessage"]
    end
    
    MODEL_REQUEST --> TOOL_SCHEMA
    TOOL_SCHEMA --> PREPARE_INVOCATION
    PREPARE_INVOCATION --> CONFIRMATION
    CONFIRMATION --> INVOKE_METHOD
    
    INVOKE_METHOD --> WORKSPACE_SERVICE
    INVOKE_METHOD --> TERMINAL_SERVICE
    INVOKE_METHOD --> TASKS_SERVICE
    INVOKE_METHOD --> FILE_SYSTEM
    
    INVOKE_METHOD --> RESULT_CONSTRUCTION
    RESULT_CONSTRUCTION --> PROGRESS_INDICATION
```

Sources: [src/extension/tools/node/runTaskTool.tsx:153-179](), [src/extension/tools/node/getTaskOutputTool.tsx:55-69]()

## Terminal State Context Integration

The extension provides comprehensive terminal and task state context to AI agents through the `TerminalAndTaskStatePromptElement`, enabling intelligent decision-making about build processes, command execution, and workspace state.

### Context Information Flow

```mermaid
graph TB
    subgraph "Context Collection"
        TASK_COLLECTION["Task Collection<br/>tasksService.getTasks()"]
        TERMINAL_COLLECTION["Terminal Collection<br/>terminalService.getCopilotTerminals()"]
        COMMAND_HISTORY["Command History<br/>getLastCommandForTerminal()"]
        TASK_STATUS["Task Status<br/>isTaskActive()"]
    end
    
    subgraph "Context Aggregation"
        TASK_INFO["Task Information<br/>name, type, command, isActive"]
        TERMINAL_INFO["Terminal Information<br/>name, lastCommand, cwd, exitCode"]
        OUTPUT_REFERENCE["Output References<br/>Use GetTerminalOutput for ID"]
    end
    
    subgraph "Prompt Integration"
        TERMINAL_TASK_STATE["TerminalAndTaskStatePromptElement<br/>Context rendering"]
        AGENT_PROMPT["AgentPrompt<br/>Agent context inclusion"]
        USER_MESSAGE["AgentUserMessage<br/>Current context"]
    end
    
    TASK_COLLECTION --> TASK_INFO
    TERMINAL_COLLECTION --> TERMINAL_INFO
    COMMAND_HISTORY --> TERMINAL_INFO
    TASK_STATUS --> TASK_INFO
    
    TASK_INFO --> TERMINAL_TASK_STATE
    TERMINAL_INFO --> TERMINAL_TASK_STATE
    OUTPUT_REFERENCE --> TERMINAL_TASK_STATE
    
    TERMINAL_TASK_STATE --> AGENT_PROMPT
    AGENT_PROMPT --> USER_MESSAGE
```

Sources: [src/extension/prompts/node/base/terminalAndTaskState.tsx:26-109](), [src/extension/prompts/node/agent/agentPrompt.tsx:281]()

The terminal and task state system enables AI agents to understand the current development environment state, including:

- **Active Tasks**: Background processes, build tasks, and their execution status
- **Terminal State**: Command history, working directories, and exit codes
- **Output Access**: References to terminal output through tool invocation
- **Task Dependencies**: Problem matchers, task groups, and dependency chains

This contextual information allows agents to make informed decisions about when to run builds, execute tests, or investigate command failures, creating a more intelligent and context-aware development assistant.

Sources: [src/extension/prompts/node/base/terminalAndTaskState.tsx:27-44](), [src/platform/tasks/vscode/tasksService.ts:161-169]()