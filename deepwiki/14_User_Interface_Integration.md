# User Interface Integration

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [package.nls.json](package.nls.json)
- [src/extension/contextKeys/vscode-node/contextKeys.contribution.ts](src/extension/contextKeys/vscode-node/contextKeys.contribution.ts)
- [src/extension/conversation/node/githubPullRequestProviders.ts](src/extension/conversation/node/githubPullRequestProviders.ts)
- [src/extension/conversation/vscode-node/userActions.ts](src/extension/conversation/vscode-node/userActions.ts)
- [src/extension/inlineChat/vscode-node/inlineChatCodeActions.ts](src/extension/inlineChat/vscode-node/inlineChatCodeActions.ts)
- [src/extension/inlineChat/vscode-node/inlineChatCommands.ts](src/extension/inlineChat/vscode-node/inlineChatCommands.ts)
- [src/extension/inlineEdits/vscode-node/inlineCompletionProvider.ts](src/extension/inlineEdits/vscode-node/inlineCompletionProvider.ts)
- [src/extension/intents/common/intents.ts](src/extension/intents/common/intents.ts)
- [src/extension/intents/node/allIntents.ts](src/extension/intents/node/allIntents.ts)
- [src/extension/intents/node/editCodeIntent2.ts](src/extension/intents/node/editCodeIntent2.ts)

</details>



This document covers how the GitHub Copilot Chat extension integrates with VS Code's user interface through commands, code actions, context keys, and user feedback systems. It details the mechanisms for registering UI components, handling user interactions, and providing contextual actions throughout the VS Code interface.

For information about the core chat functionality and language model tools, see [Chat Participants and Language Model Tools](#3). For configuration management, see [Configuration System](#6).

## Command System

The extension registers numerous commands that provide entry points for Copilot functionality throughout VS Code. Commands are organized into logical groups and registered through the VS Code API.

### Command Registration Architecture

```mermaid
graph TB
    subgraph "Command Registration"
        REG["registerInlineChatCommands()"]
        DISPOSABLES["DisposableStore"]
        VSC_API["vscode.commands.registerCommand()"]
    end
    
    subgraph "Command Categories"
        EXPLAIN["Explain Commands"]
        REVIEW["Review Commands"]
        GENERATE["Generate Commands"]
        INLINE["Inline Chat Commands"]
        TERMINAL["Terminal Commands"]
    end
    
    subgraph "Command Handlers"
        DO_EXPLAIN["doExplain()"]
        DO_REVIEW["doReview()"]
        DO_GENERATE["doGenerate()"]
        DO_FIX["doFix()"]
        DO_APPLY["doApplyReview()"]
    end
    
    subgraph "VS Code Integration"
        PALETTE["Command Palette"]
        CONTEXT_MENU["Context Menu"]
        EDITOR_ACTIONS["Editor Actions"]
        CHAT_INTERFACE["Chat Interface"]
    end
    
    REG --> DISPOSABLES
    DISPOSABLES --> VSC_API
    VSC_API --> EXPLAIN
    VSC_API --> REVIEW
    VSC_API --> GENERATE
    VSC_API --> INLINE
    VSC_API --> TERMINAL
    
    EXPLAIN --> DO_EXPLAIN
    REVIEW --> DO_REVIEW
    GENERATE --> DO_GENERATE
    INLINE --> DO_FIX
    REVIEW --> DO_APPLY
    
    DO_EXPLAIN --> PALETTE
    DO_REVIEW --> CONTEXT_MENU
    DO_GENERATE --> EDITOR_ACTIONS
    DO_FIX --> CHAT_INTERFACE
```

**Sources:** [src/extension/inlineChat/vscode-node/inlineChatCommands.ts:51-350]()

### Key Command Categories

| Category | Examples | Purpose |
|----------|----------|---------|
| Explain | `github.copilot.chat.explain` | Code explanation and diagnostics |
| Review | `github.copilot.chat.review` | Code review workflows |
| Generate | `github.copilot.chat.generate` | Code generation tasks |
| Fix | `github.copilot.chat.fix` | Error fixing and diagnostics |
| Terminal | `github.copilot.chat.explainTerminalSelection` | Terminal integration |

The command system uses a `DisposableStore` to manage lifecycle and proper cleanup of registered commands.

**Sources:** [src/extension/inlineChat/vscode-node/inlineChatCommands.ts:63-349](), [package.nls.json:7-28]()

## Code Actions

Code actions provide contextual suggestions and fixes directly in the editor. The extension implements two main code action providers: `QuickFixesProvider` and `RefactorsProvider`.

### Code Action Provider Architecture

```mermaid
graph TB
    subgraph "Code Action Providers"
        QUICK_FIXES["QuickFixesProvider"]
        REFACTORS["RefactorsProvider"]
        REGISTRATION["vscode.languages.registerCodeActionsProvider()"]
    end
    
    subgraph "Quick Fix Actions"
        FIX_KIND["fixKind"]
        EXPLAIN_KIND["explainKind"]
        REVIEW_KIND["reviewKind"]
        ALT_TEXT["provideAltTextQuickFix()"]
    end
    
    subgraph "Refactor Actions"
        GENERATE_KIND["generateOrModifyKind"]
        DOCS_KIND["generateDocsKind"]
        TESTS_KIND["generateTestsKind"]
        DOC_GEN["provideDocGenCodeAction()"]
        TEST_GEN["provideTestGenCodeAction()"]
    end
    
    subgraph "Action Triggers"
        DIAGNOSTICS["Diagnostics"]
        SELECTION["Selection"]
        CURSOR_POSITION["Cursor Position"]
        TREE_SITTER["Tree-sitter AST"]
    end
    
    subgraph "Commands Invoked"
        EDITOR_CHAT["vscode.editorChat.start"]
        CHAT_EXPLAIN["github.copilot.chat.explain"]
        CHAT_REVIEW["github.copilot.chat.review"]
        GENERATE_TESTS["github.copilot.chat.generateTests"]
    end
    
    REGISTRATION --> QUICK_FIXES
    REGISTRATION --> REFACTORS
    
    QUICK_FIXES --> FIX_KIND
    QUICK_FIXES --> EXPLAIN_KIND
    QUICK_FIXES --> REVIEW_KIND
    QUICK_FIXES --> ALT_TEXT
    
    REFACTORS --> GENERATE_KIND
    REFACTORS --> DOCS_KIND
    REFACTORS --> TESTS_KIND
    REFACTORS --> DOC_GEN
    REFACTORS --> TEST_GEN
    
    DIAGNOSTICS --> FIX_KIND
    SELECTION --> REVIEW_KIND
    CURSOR_POSITION --> GENERATE_KIND
    TREE_SITTER --> DOC_GEN
    TREE_SITTER --> TEST_GEN
    
    FIX_KIND --> EDITOR_CHAT
    EXPLAIN_KIND --> CHAT_EXPLAIN
    REVIEW_KIND --> CHAT_REVIEW
    TEST_GEN --> GENERATE_TESTS
```

**Sources:** [src/extension/inlineChat/vscode-node/inlineChatCodeActions.ts:33-394]()

### Quick Fix Provider

The `QuickFixesProvider` offers contextual fixes based on diagnostics and selection:

- **Fix Action**: Triggered by diagnostics, launches inline chat with `/fix` command
- **Explain Action**: Provides explanations for diagnostics or selected code
- **Review Action**: Offers code review when selection is not empty
- **Alt Text Generation**: Detects image markdown and offers alt text generation

**Sources:** [src/extension/inlineChat/vscode-node/inlineChatCodeActions.ts:33-187]()

### Refactor Provider

The `RefactorsProvider` offers code generation and documentation actions:

- **Generate/Modify**: Context-sensitive code generation based on cursor position
- **Documentation**: Uses Tree-sitter AST to identify documentable nodes
- **Test Generation**: Identifies testable code structures for test generation

**Sources:** [src/extension/inlineChat/vscode-node/inlineChatCodeActions.ts:189-394]()

## Context Keys

Context keys control the visibility and behavior of UI elements based on authentication state, feature flags, and user preferences.

### Context Key Management

```mermaid
graph TB
    subgraph "Context Key Controller"
        CONTEXT_CONTRIB["ContextKeysContribution"]
        INSPECT["_inspectContext()"]
        AUTH_CHANGE["_onAuthenticationChange()"]
    end
    
    subgraph "Welcome View Context Keys"
        ACTIVATED["github.copilot-chat.activated"]
        OFFLINE["github.copilot.offline"]
        INDIVIDUAL_DISABLED["github.copilot.interactiveSession.individual.disabled"]
        INDIVIDUAL_EXPIRED["github.copilot.interactiveSession.individual.expired"]
        CONTACT_SUPPORT["github.copilot.interactiveSession.contactSupport"]
        ENTERPRISE_DISABLED["github.copilot.interactiveSession.enterprise.disabled"]
        CHAT_DISABLED["github.copilot.interactiveSession.chatDisabled"]
    end
    
    subgraph "Feature Context Keys"
        QUOTA_EXCEEDED["github.copilot.chat.quotaExceeded"]
        SHOW_LOG_VIEW["github.copilot.chat.showLogView"]
        DEBUG_REPORT["github.copilot.debugReportFeedback"]
        PREVIEW_DISABLED["github.copilot.previewFeaturesDisabled"]
        BYOK_ENABLED["github.copilot.byokEnabled"]
        DEBUG_CONTEXT["github.copilot.chat.debug"]
    end
    
    subgraph "Authentication Errors"
        NOT_SIGNED_UP["NotSignedUpError"]
        SUBSCRIPTION_EXPIRED["SubscriptionExpiredError"]
        ENTERPRISE_MANAGED["EnterpriseManagedError"]
        CONTACT_SUPPORT_ERR["ContactSupportError"]
        CHAT_DISABLED_ERR["ChatDisabledError"]
        FETCHER_ERROR["FetcherError"]
    end
    
    subgraph "VS Code Commands"
        SET_CONTEXT["commands.executeCommand('setContext')"]
        REFRESH_TOKEN["github.copilot.refreshToken"]
        SHOW_CHAT_LOG["github.copilot.debug.showChatLogView"]
    end
    
    CONTEXT_CONTRIB --> INSPECT
    CONTEXT_CONTRIB --> AUTH_CHANGE
    
    INSPECT --> ACTIVATED
    INSPECT --> OFFLINE
    INSPECT --> INDIVIDUAL_DISABLED
    INSPECT --> INDIVIDUAL_EXPIRED
    INSPECT --> CONTACT_SUPPORT
    INSPECT --> ENTERPRISE_DISABLED
    INSPECT --> CHAT_DISABLED
    
    AUTH_CHANGE --> QUOTA_EXCEEDED
    AUTH_CHANGE --> PREVIEW_DISABLED
    AUTH_CHANGE --> BYOK_ENABLED
    
    NOT_SIGNED_UP --> INDIVIDUAL_DISABLED
    SUBSCRIPTION_EXPIRED --> INDIVIDUAL_EXPIRED
    ENTERPRISE_MANAGED --> ENTERPRISE_DISABLED
    CONTACT_SUPPORT_ERR --> CONTACT_SUPPORT
    CHAT_DISABLED_ERR --> CHAT_DISABLED
    FETCHER_ERROR --> OFFLINE
    
    ACTIVATED --> SET_CONTEXT
    OFFLINE --> SET_CONTEXT
    INDIVIDUAL_DISABLED --> SET_CONTEXT
    
    REFRESH_TOKEN --> INSPECT
    SHOW_CHAT_LOG --> SHOW_LOG_VIEW
```

**Sources:** [src/extension/contextKeys/vscode-node/contextKeys.contribution.ts:20-208]()

### Context Key Categories

| Category | Keys | Purpose |
|----------|------|---------|
| Welcome View | `github.copilot-chat.activated` | Controls welcome view visibility |
| Authentication | `github.copilot.offline` | Handles offline/connection states |
| Feature Flags | `github.copilot.previewFeaturesDisabled` | Controls preview feature access |
| Debug | `github.copilot.chat.debug` | Debug mode functionality |

**Sources:** [src/extension/contextKeys/vscode-node/contextKeys.contribution.ts:20-38]()

## User Feedback and Telemetry

The extension captures detailed user interactions and feedback through the `UserFeedbackService`.

### User Action Handling Flow

```mermaid
graph TB
    subgraph "User Action Events"
        CHAT_ACTION["vscode.ChatUserActionEvent"]
        RESULT_FEEDBACK["vscode.ChatResultFeedback"]
        HANDLER["handleUserAction()"]
        FEEDBACK_HANDLER["handleFeedback()"]
    end
    
    subgraph "Action Types"
        COPY["copy"]
        INSERT["insert"]
        RUN_TERMINAL["runInTerminal"]
        FOLLOW_UP["followUp"]
        BUG_REPORT["bug"]
        EDIT_SESSION["chatEditingSessionAction"]
        APPLY["apply"]
    end
    
    subgraph "Inline Chat Actions"
        INLINE_HANDLER["_handleInlineChatUserAction()"]
        ACCEPTED["InteractiveEditorResponseFeedbackKind.Accepted"]
        UNDONE["InteractiveEditorResponseFeedbackKind.Undone"]
        HELPFUL["InteractiveEditorResponseFeedbackKind.Helpful"]
        UNHELPFUL["InteractiveEditorResponseFeedbackKind.Unhelpful"]
    end
    
    subgraph "Telemetry Events"
        PANEL_COPY["panel.action.copy"]
        PANEL_INSERT["panel.action.insert"]
        PANEL_VOTE["panel.action.vote"]
        INLINE_VOTE["inline.action.vote"]
        INLINE_DONE["inline.done"]
        EDIT_SURVIVAL["inline.trackEditSurvival"]
    end
    
    subgraph "Services"
        TELEMETRY["ITelemetryService"]
        CONVERSATION_STORE["IConversationStore"]
        FEEDBACK_REPORTER["IFeedbackReporter"]
        SURVEY_SERVICE["ISurveyService"]
    end
    
    CHAT_ACTION --> HANDLER
    RESULT_FEEDBACK --> FEEDBACK_HANDLER
    
    HANDLER --> COPY
    HANDLER --> INSERT
    HANDLER --> RUN_TERMINAL
    HANDLER --> FOLLOW_UP
    HANDLER --> BUG_REPORT
    HANDLER --> EDIT_SESSION
    HANDLER --> APPLY
    
    FEEDBACK_HANDLER --> INLINE_HANDLER
    INLINE_HANDLER --> ACCEPTED
    INLINE_HANDLER --> UNDONE
    INLINE_HANDLER --> HELPFUL
    INLINE_HANDLER --> UNHELPFUL
    
    COPY --> PANEL_COPY
    INSERT --> PANEL_INSERT
    FEEDBACK_HANDLER --> PANEL_VOTE
    HELPFUL --> INLINE_VOTE
    ACCEPTED --> INLINE_DONE
    ACCEPTED --> EDIT_SURVIVAL
    
    PANEL_COPY --> TELEMETRY
    PANEL_INSERT --> TELEMETRY
    PANEL_VOTE --> TELEMETRY
    INLINE_VOTE --> TELEMETRY
    INLINE_DONE --> TELEMETRY
    EDIT_SURVIVAL --> TELEMETRY
    
    HANDLER --> CONVERSATION_STORE
    HANDLER --> FEEDBACK_REPORTER
    HANDLER --> SURVEY_SERVICE
```

**Sources:** [src/extension/conversation/vscode-node/userActions.ts:38-538]()

### Telemetry Data Collection

The extension tracks various user interactions:

- **Panel Actions**: Copy, insert, run in terminal, follow-up actions
- **Inline Chat**: Accept/reject suggestions, vote on helpfulness
- **Edit Survival**: Tracks how long accepted edits remain in code
- **Diagnostics**: Problem counts and diagnostic information

**Sources:** [src/extension/conversation/vscode-node/userActions.ts:66-537]()

## Inline Completions

The extension provides inline edit suggestions through the `InlineCompletionProviderImpl`.

### Inline Completion Architecture

```mermaid
graph TB
    subgraph "Inline Completion Provider"
        PROVIDER["InlineCompletionProviderImpl"]
        PROVIDE_ITEMS["provideInlineCompletionItems()"]
        HANDLE_SHOWN["handleDidShowCompletionItem()"]
        HANDLE_LIFETIME["handleEndOfLifetime()"]
    end
    
    subgraph "Completion Sources"
        NEXT_EDIT["NextEditProvider"]
        DIAGNOSTICS["DiagnosticsBasedProvider"]
        RACE_ALL["raceAndAll()"]
    end
    
    subgraph "Completion Items"
        NES_ITEM["NesCompletionItem"]
        LLM_INFO["LlmCompletionInfo"]
        DIAGNOSTICS_INFO["DiagnosticsCompletionInfo"]
        COMPLETION_LIST["NesCompletionList"]
    end
    
    subgraph "Lifecycle Events"
        ACCEPTED["InlineCompletionEndOfLifeReasonKind.Accepted"]
        REJECTED["InlineCompletionEndOfLifeReasonKind.Rejected"]
        IGNORED["InlineCompletionEndOfLifeReasonKind.Ignored"]
        SURVIVAL_TRACKING["_trackSurvivalRate()"]
    end
    
    subgraph "Telemetry"
        TELEMETRY_BUILDER["NextEditProviderTelemetryBuilder"]
        TELEMETRY_SENDER["TelemetrySender"]
        SURVIVAL_REPORTER["EditSurvivalReporter"]
    end
    
    PROVIDER --> PROVIDE_ITEMS
    PROVIDER --> HANDLE_SHOWN
    PROVIDER --> HANDLE_LIFETIME
    
    PROVIDE_ITEMS --> NEXT_EDIT
    PROVIDE_ITEMS --> DIAGNOSTICS
    PROVIDE_ITEMS --> RACE_ALL
    
    RACE_ALL --> NES_ITEM
    NES_ITEM --> LLM_INFO
    NES_ITEM --> DIAGNOSTICS_INFO
    NES_ITEM --> COMPLETION_LIST
    
    HANDLE_LIFETIME --> ACCEPTED
    HANDLE_LIFETIME --> REJECTED
    HANDLE_LIFETIME --> IGNORED
    
    ACCEPTED --> SURVIVAL_TRACKING
    SURVIVAL_TRACKING --> SURVIVAL_REPORTER
    
    PROVIDE_ITEMS --> TELEMETRY_BUILDER
    TELEMETRY_BUILDER --> TELEMETRY_SENDER
    SURVIVAL_REPORTER --> TELEMETRY_SENDER
```

**Sources:** [src/extension/inlineEdits/vscode-node/inlineCompletionProvider.ts:86-498]()

### Completion Item Processing

The provider handles multiple completion sources through a racing mechanism:

1. **LLM Provider**: Primary source for AI-generated suggestions
2. **Diagnostics Provider**: Provides fixes for compiler errors
3. **Race Strategy**: Returns first available suggestion while collecting all results

**Sources:** [src/extension/inlineEdits/vscode-node/inlineCompletionProvider.ts:160-195]()

## Extension Integration

The extension integrates with other VS Code extensions to provide enhanced functionality.

### GitHub Pull Request Integration

```mermaid
graph TB
    subgraph "GitHub PR Extension Integration"
        PR_PROVIDERS["GitHubPullRequestProviders"]
        GITHUB_API["GitHub Extension API"]
        EXTENSION_SERVICE["IExtensionsService"]
    end
    
    subgraph "PR Providers"
        TITLE_DESC["GitHubPullRequestTitleAndDescriptionGenerator"]
        REVIEWER_COMMENTS["GitHubPullRequestReviewerCommentsProvider"]
        REGISTRATION["registerTitleAndDescriptionProvider()"]
    end
    
    subgraph "Extension Activation"
        GET_EXTENSION["getExtension()"]
        ACTIVATE["extension.activate()"]
        INITIALIZE["initializeGitHubPRExtensionApi()"]
    end
    
    subgraph "Repository Information"
        REPO_DESC["getRepositoryDescription()"]
        REPO_API["gitHubExtensionApi.getRepositoryDescription()"]
    end
    
    PR_PROVIDERS --> GITHUB_API
    PR_PROVIDERS --> EXTENSION_SERVICE
    
    GITHUB_API --> TITLE_DESC
    GITHUB_API --> REVIEWER_COMMENTS
    GITHUB_API --> REGISTRATION
    
    EXTENSION_SERVICE --> GET_EXTENSION
    GET_EXTENSION --> ACTIVATE
    ACTIVATE --> INITIALIZE
    
    INITIALIZE --> REGISTRATION
    
    PR_PROVIDERS --> REPO_DESC
    REPO_DESC --> REPO_API
```

**Sources:** [src/extension/conversation/node/githubPullRequestProviders.ts:17-131]()

### Extension Discovery and Activation

The extension uses the `IExtensionsService` to discover and activate the GitHub Pull Request extension, then registers providers for enhanced PR functionality.

**Sources:** [src/extension/conversation/node/githubPullRequestProviders.ts:33-65]()

## Configuration and Localization

The extension uses extensive configuration options and localization strings to provide a customizable user experience.

### Localization Structure

The extension includes comprehensive localization through `package.nls.json` with categorized strings:

| Category | Examples | Purpose |
|----------|----------|---------|
| Commands | `github.copilot.command.explainThis` | Command titles and descriptions |
| Welcome Views | `github.copilot.viewsWelcome.signIn` | Welcome screen messages |
| Tools | `copilot.tools.applyPatch.name` | Tool names and descriptions |
| Configuration | `github.copilot.config.enableCodeActions` | Setting descriptions |

**Sources:** [package.nls.json:1-297]()

### Participant Mode Mapping

The extension maps chat participant IDs to telemetry mode names through the `participantIdToModeName` function:

- **ask**: Default, workspace, vscode, and terminalPanel participants
- **agent**: Edits agent participant
- **edit**: Editing session participants
- **inline**: Editor and terminal participants

**Sources:** [src/extension/intents/common/intents.ts:11-30]()

This comprehensive user interface integration ensures that Copilot functionality is accessible throughout VS Code while maintaining proper telemetry, feedback collection, and user experience standards.