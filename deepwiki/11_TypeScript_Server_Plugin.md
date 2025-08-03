# TypeScript Server Plugin

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [src/extension/typescriptContext/common/serverProtocol.ts](src/extension/typescriptContext/common/serverProtocol.ts)
- [src/extension/typescriptContext/serverPlugin/src/common/api.ts](src/extension/typescriptContext/serverPlugin/src/common/api.ts)
- [src/extension/typescriptContext/serverPlugin/src/common/baseContextProviders.ts](src/extension/typescriptContext/serverPlugin/src/common/baseContextProviders.ts)
- [src/extension/typescriptContext/serverPlugin/src/common/classContextProvider.ts](src/extension/typescriptContext/serverPlugin/src/common/classContextProvider.ts)
- [src/extension/typescriptContext/serverPlugin/src/common/code.ts](src/extension/typescriptContext/serverPlugin/src/common/code.ts)
- [src/extension/typescriptContext/serverPlugin/src/common/methodContextProvider.ts](src/extension/typescriptContext/serverPlugin/src/common/methodContextProvider.ts)
- [src/extension/typescriptContext/serverPlugin/src/common/protocol.ts](src/extension/typescriptContext/serverPlugin/src/common/protocol.ts)
- [src/extension/typescriptContext/serverPlugin/src/common/sourceFileContextProvider.ts](src/extension/typescriptContext/serverPlugin/src/common/sourceFileContextProvider.ts)
- [src/extension/typescriptContext/serverPlugin/src/common/typescripts.ts](src/extension/typescriptContext/serverPlugin/src/common/typescripts.ts)
- [src/extension/typescriptContext/serverPlugin/src/node/test/simple.spec.ts](src/extension/typescriptContext/serverPlugin/src/node/test/simple.spec.ts)

</details>



## Purpose and Scope

The TypeScript Server Plugin provides server-side context computation for AI-powered code assistance in TypeScript and JavaScript projects. It runs as a plugin within the TypeScript Language Server and analyzes code structure, symbols, and relationships to generate relevant context information for AI models.

This plugin specifically handles the computation of TypeScript/JavaScript context on the server side, including symbol resolution, type analysis, and code snippet generation. For information about the broader language context system integration, see [Language Context System](#5). For client-side context consumption and caching, see [Configuration System](#6).

## Architecture Overview

The plugin operates as a TypeScript server plugin that hooks into the language service to provide context computation capabilities. It follows a provider-based architecture where different context providers handle specific code constructs.

### Core Components

```mermaid
graph TB
    TSServer["TypeScript Server"]
    Plugin["ServerPlugin"]
    API["api.ts<br/>computeContext()"]
    
    subgraph "Context Providers"
        SourceFile["SourceFileContextProvider"]
        Class["ClassContextProvider"]
        Method["MethodContextProvider"]
        Function["FunctionContextProvider"]
        Constructor["ConstructorContextProvider"]
        Module["ModuleContextProvider"]
    end
    
    subgraph "Core Services"
        Symbols["Symbols<br/>Symbol Analysis"]
        CodeBuilder["CodeSnippetBuilder<br/>Code Generation"]
        Protocol["Protocol<br/>Request/Response"]
        Cache["CacheInfo<br/>Performance"]
    end
    
    TSServer --> Plugin
    Plugin --> API
    API --> SourceFile
    API --> Class
    API --> Method
    API --> Function
    API --> Constructor
    API --> Module
    
    SourceFile --> Symbols
    Class --> Symbols
    Method --> Symbols
    Function --> Symbols
    Constructor --> Symbols
    Module --> Symbols
    
    Symbols --> CodeBuilder
    CodeBuilder --> Protocol
    Protocol --> Cache
```

Sources: [src/extension/typescriptContext/serverPlugin/src/common/api.ts:40-51](), [src/extension/typescriptContext/serverPlugin/src/common/api.ts:129-142]()

### Request Processing Flow

```mermaid
graph LR
    Request["ComputeContextRequest"]
    TokenInfo["getRelevantTokens()"]
    Providers["ContextProviders"]
    Collector["ContextRunnableCollector"]
    Execution["executeRunnables()"]
    Response["ContextRequestResult"]
    
    Request --> TokenInfo
    TokenInfo --> Providers
    Providers --> Collector
    Collector --> Execution
    Execution --> Response
    
    subgraph "Runnable Types"
        Primary["Primary<br/>Signatures, Locals"]
        Secondary["Secondary<br/>Imports, Globals"]
        Tertiary["Tertiary<br/>Neighbor Files"]
    end
    
    Execution --> Primary
    Execution --> Secondary
    Execution --> Tertiary
```

Sources: [src/extension/typescriptContext/serverPlugin/src/common/api.ts:62-72](), [src/extension/typescriptContext/serverPlugin/src/common/api.ts:88-97]()

## Context Provider System

The plugin uses a hierarchical context provider system that analyzes different code constructs and generates appropriate context items.

### Provider Factory Registration

Context providers are registered based on TypeScript syntax kinds and instantiated dynamically based on cursor position:

| Syntax Kind | Provider Class | Purpose |
|-------------|----------------|---------|
| `SourceFile` | `SourceFileContextProvider` | File-level context |
| `FunctionDeclaration` | `FunctionContextProvider` | Function signatures and locals |
| `ArrowFunction` | `FunctionContextProvider` | Arrow function context |
| `ClassDeclaration` | `ClassContextProvider` | Class inheritance and structure |
| `MethodDeclaration` | `MethodContextProvider` | Method signatures and blueprints |
| `Constructor` | `ConstructorContextProvider` | Constructor patterns |
| `ModuleDeclaration` | `ModuleContextProvider` | Module exports and structure |

Sources: [src/extension/typescriptContext/serverPlugin/src/common/api.ts:42-51]()

### Context Runnable Execution

Each provider generates context runnables that are executed in priority order:

```mermaid
graph TB
    subgraph "Priority Levels"
        Primary["Primary Runnables<br/>Priorities.Locals (1.0)<br/>Priorities.Inherited (0.9)"]
        Secondary["Secondary Runnables<br/>Priorities.Imports (0.6)<br/>Priorities.Globals (0.5)"]
        Tertiary["Tertiary Runnables<br/>Priorities.NeighborFiles (0.55)"]
    end
    
    subgraph "Runnable Types"
        Signature["SignatureRunnable<br/>Function parameters and return types"]
        Locals["TypeOfLocalsRunnable<br/>Local variable types"]
        Imports["ImportsRunnable<br/>Import declarations"]
        Globals["GlobalsRunnable<br/>Global scope symbols"]
        Neighbors["TypesOfNeighborFilesRunnable<br/>Related file exports"]
        Blueprint["SimilarClassRunnable<br/>Class inheritance patterns"]
    end
    
    Primary --> Signature
    Primary --> Locals
    Primary --> Blueprint
    Secondary --> Imports
    Secondary --> Globals
    Tertiary --> Neighbors
```

Sources: [src/extension/typescriptContext/serverPlugin/src/common/baseContextProviders.ts:558-578](), [src/extension/typescriptContext/serverPlugin/src/common/protocol.ts:106-115]()

## Symbol Analysis and Code Generation

The plugin performs sophisticated symbol analysis using the TypeScript compiler API to understand code structure and relationships.

### Symbol Resolution Pipeline

```mermaid
graph LR
    Node["AST Node"]
    Symbol["getSymbolAtLocation()"]
    Alias["getAliasedSymbol()"]
    Leaf["getLeafSymbol()"]
    Analysis["Symbol Analysis"]
    
    Node --> Symbol
    Symbol --> Alias
    Alias --> Leaf
    Leaf --> Analysis
    
    subgraph "Symbol Types"
        Class["Class Symbols<br/>SymbolFlags.Class"]
        Interface["Interface Symbols<br/>SymbolFlags.Interface"]
        Function["Function Symbols<br/>SymbolFlags.Function"]
        Property["Property Symbols<br/>SymbolFlags.Property"]
        Method["Method Symbols<br/>SymbolFlags.Method"]
    end
    
    Analysis --> Class
    Analysis --> Interface
    Analysis --> Function
    Analysis --> Property
    Analysis --> Method
```

Sources: [src/extension/typescriptContext/serverPlugin/src/common/typescripts.ts:746-752](), [src/extension/typescriptContext/serverPlugin/src/common/typescripts.ts:792-798](), [src/extension/typescriptContext/serverPlugin/src/common/typescripts.ts:814-835]()

### Code Snippet Generation

The `CodeSnippetBuilder` generates formatted code snippets from TypeScript symbols:

```mermaid
graph TB
    Builder["CodeSnippetBuilder"]
    
    subgraph "Emitter Types"
        ClassEmitter["ClassEmitter<br/>Class declarations with inheritance"]
        InterfaceEmitter["InterfaceEmitter<br/>Interface declarations with supertypes"]
        FunctionEmitter["FunctionEmitter<br/>Function declarations"]
        EnumEmitter["EnumEmitter<br/>Enum declarations"]
        ModuleEmitter["ModuleEmitter<br/>Module declarations"]
    end
    
    subgraph "Output Format"
        Snippet["CodeSnippet<br/>fileName, value, priority"]
        Key["Caching Key<br/>Symbol-based versioning"]
        Sources["Additional Sources<br/>Referenced files"]
    end
    
    Builder --> ClassEmitter
    Builder --> InterfaceEmitter
    Builder --> FunctionEmitter
    Builder --> EnumEmitter
    Builder --> ModuleEmitter
    
    ClassEmitter --> Snippet
    InterfaceEmitter --> Snippet
    FunctionEmitter --> Snippet
    EnumEmitter --> Snippet
    ModuleEmitter --> Snippet
    
    Snippet --> Key
    Snippet --> Sources
```

Sources: [src/extension/typescriptContext/serverPlugin/src/common/code.ts:598-617](), [src/extension/typescriptContext/serverPlugin/src/common/code.ts:689-698](), [src/extension/typescriptContext/serverPlugin/src/common/code.ts:711-720]()

## Blueprint Search System

The plugin includes a sophisticated blueprint search system that finds similar code patterns to provide relevant examples for AI code generation.

### Class Blueprint Search

```mermaid
graph TB
    ClassDecl["ClassDeclaration<br/>Target class"]
    Blueprint["ClassBlueprintSearch"]
    
    subgraph "Search Strategy"
        Extends["Extends Analysis<br/>Super class symbols"]
        Implements["Implements Analysis<br/>Interface symbols"]
        Abstract["Abstract Members<br/>Member count scoring"]
    end
    
    subgraph "Search Types"
        Similar["SimilarClassRunnable<br/>Find classes with similar interfaces"]
        Private["PrivateMethodBlueprintSearch<br/>Find private method patterns"]
        Subclass["FindMethodInSubclassSearch<br/>Find method implementations"]
        Hierarchy["FindMethodInHierarchySearch<br/>Find interface implementations"]
    end
    
    ClassDecl --> Blueprint
    Blueprint --> Extends
    Blueprint --> Implements
    Blueprint --> Abstract
    
    Blueprint --> Similar
    Blueprint --> Private
    Blueprint --> Subclass
    Blueprint --> Hierarchy
```

Sources: [src/extension/typescriptContext/serverPlugin/src/common/classContextProvider.ts:25-115](), [src/extension/typescriptContext/serverPlugin/src/common/methodContextProvider.ts:54-139]()

## Protocol and Communication

The plugin communicates using a structured protocol for context computation requests and responses.

### Request/Response Structure

```mermaid
graph LR
    subgraph "Request Types"
        Compute["ComputeContextRequest<br/>file, position, budgets"]
        Ping["PingRequest<br/>Health check"]
    end
    
    subgraph "Response Types"
        Result["ContextRequestResult<br/>state, items, timings"]
        Cached["CachedContextRunnableResult<br/>cache info, references"]
        Error["ErrorResponse<br/>error codes, messages"]
    end
    
    subgraph "Context Items"
        Snippet["CodeSnippet<br/>code, fileName, priority"]
        Trait["Trait<br/>project characteristics"]
        Reference["ContextItemReference<br/>cached item keys"]
    end
    
    Compute --> Result
    Compute --> Cached
    Compute --> Error
    Ping --> Result
    
    Result --> Snippet
    Result --> Trait
    Result --> Reference
```

Sources: [src/extension/typescriptContext/serverPlugin/src/common/protocol.ts:398-404](), [src/extension/typescriptContext/serverPlugin/src/common/protocol.ts:358-396](), [src/extension/typescriptContext/serverPlugin/src/common/protocol.ts:183-210]()

### Cache Scope Management

The plugin implements sophisticated caching with different scope strategies:

| Cache Scope | Description | Use Case |
|-------------|-------------|----------|
| `File` | Valid for entire file | Compiler options, traits |
| `WithinRange` | Valid within specific range | Function/method bodies |
| `OutsideRange` | Valid outside specific ranges | Import declarations |
| `NeighborFiles` | Valid while neighbor files unchanged | Cross-file references |

Sources: [src/extension/typescriptContext/serverPlugin/src/common/protocol.ts:10-29](), [src/extension/typescriptContext/serverPlugin/src/common/protocol.ts:58-69]()

## Performance and Optimization

The plugin includes several performance optimizations to handle large codebases efficiently.

### Cancellation and Budget Management

```mermaid
graph TB
    Request["Context Request"]
    Timer["CancellationTokenWithTimer"]
    Budget["Token Budget"]
    
    subgraph "Budget Types"
        Time["Time Budget<br/>Maximum execution time"]
        Token["Token Budget<br/>Maximum context size"]
        Neighbor["Neighbor Files<br/>File processing limit"]
    end
    
    subgraph "Optimization Strategies"
        Cache["Result Caching<br/>Symbol-based keys"]
        Lazy["Lazy Evaluation<br/>On-demand computation"]
        Priority["Priority Ordering<br/>Most relevant first"]
    end
    
    Request --> Timer
    Request --> Budget
    Budget --> Time
    Budget --> Token
    Budget --> Neighbor
    
    Timer --> Cache
    Budget --> Lazy
    Budget --> Priority
```

Sources: [src/extension/typescriptContext/serverPlugin/src/common/typescripts.ts:142-167](), [src/extension/typescriptContext/serverPlugin/src/common/protocol.ts:398-404]()

### Symbol Key Generation

The plugin generates versioned keys for symbols to enable efficient caching:

```mermaid
graph LR
    Symbol["TypeScript Symbol"]
    Declarations["Symbol Declarations"]
    Fragments["Key Fragments<br/>file, version, positions"]
    Hash["MD5 Hash"]
    Key["Versioned Key"]
    
    Symbol --> Declarations
    Declarations --> Fragments
    Fragments --> Hash
    Hash --> Key
    
    subgraph "Key Components"
        File["fileName"]
        Version["scriptVersion"]
        Start["declaration.start"]
        End["declaration.end"]
        Kind["declaration.kind"]
    end
    
    Fragments --> File
    Fragments --> Version
    Fragments --> Start
    Fragments --> End
    Fragments --> Kind
```

Sources: [src/extension/typescriptContext/serverPlugin/src/common/typescripts.ts:636-683]()

## Testing and Validation

The plugin includes comprehensive testing infrastructure to validate context computation across different code patterns.

### Test Coverage Areas

The test suite covers various TypeScript/JavaScript constructs:

- **Class Analysis**: Inheritance patterns, interface implementations, abstract members
- **Method Analysis**: Public/private methods, signature types, blueprint search
- **Function Analysis**: Parameter types, return types, local variables
- **Constructor Analysis**: Inheritance patterns, parameter types
- **Type Analysis**: Type aliases, intersections, generic types
- **Import Analysis**: Named imports, namespace imports, module resolution

Sources: [src/extension/typescriptContext/serverPlugin/src/node/test/simple.spec.ts:39-402]()