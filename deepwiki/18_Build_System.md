# Build System

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [package-lock.json](package-lock.json)
- [package.json](package.json)

</details>



This document explains the build configuration, package management, and deployment processes for the GitHub Copilot Chat extension. The build system orchestrates compilation for multiple runtime environments using esbuild, manages package dependencies and VS Code extension configuration through `package.json`, and handles deployment processes for both development and production environments.

For information about code quality enforcement during builds, see page 11 (Testing). For development environment setup, see page 9 (Development Environment).

## Overview and Architecture

The build system consists of two main components: package configuration managed through `package.json` and build orchestration handled by `.esbuild.ts`. The system supports multiple runtime environments, development/production modes, and deployment processes.

### Build System Architecture

```mermaid
graph TD
    packagejson["package.json"] --> manifest["VS Code Extension Manifest"]
    packagejson --> dependencies["Dependencies & Scripts"]
    packagejson --> tools["60+ Language Model Tools"]
    packagejson --> participants["Chat Participants"]
    
    esbuild[".esbuild.ts"] --> main_fn["main()"]
    main_fn --> patch["applyPackageJsonPatch()"]
    main_fn --> tsplugin["typeScriptServerPluginPackageJsonInstall()"]
    main_fn --> watch_check{"isWatch?"}
    
    watch_check -->|Yes| watch_mode["Watch Mode"]
    watch_check -->|No| build_mode["Build Mode"]
    
    watch_mode --> create_contexts["esbuild.BuildContext[]"]
    watch_mode --> file_watcher["watcher.subscribe()"]
    file_watcher --> rebuild["rebuild()"]
    
    build_mode --> parallel_builds["Promise.all()"]
    
    create_contexts --> node_ext["nodeExtHostContext"]
    create_contexts --> web_ext["webExtHostContext"] 
    create_contexts --> node_sim["nodeSimulationContext"]
    create_contexts --> workbench_ui["nodeSimulationWorkbenchUIContext"]
    create_contexts --> sim_test["nodeExtHostSimulationContext"]
    create_contexts --> ts_plugin["typeScriptServerPluginContext"]
    
    parallel_builds --> dist_output["dist/ Output"]
    parallel_builds --> vscode_ext[".vscode/extensions/"]
    parallel_builds --> node_modules["node_modules/"]
```

Sources: [package.json:1-3000](), [.esbuild.ts:250-355]()

## Package Configuration and Management

The `package.json` file serves as the central configuration for the VS Code extension, defining metadata, dependencies, and the extensive contribution points that make up the Copilot Chat functionality.

### Extension Manifest Structure

```mermaid
graph LR
    packagejson["package.json"] --> metadata["Extension Metadata"]
    packagejson --> engines["Engine Requirements"]
    packagejson --> contributions["Contribution Points"]
    packagejson --> dependencies["Dependencies"]
    
    metadata --> name["copilot-chat"]
    metadata --> publisher["GitHub"]
    metadata --> version["0.30.0"]
    metadata --> build_info["buildType, internalAIKey"]
    
    engines --> vscode_version["^1.103.0-insider"]
    engines --> node_version[">=22.14.0"]
    engines --> npm_version[">=9.0.0"]
    
    contributions --> language_model_tools["languageModelTools[136]"]
    contributions --> chat_participants["chatParticipants[8]"]
    contributions --> commands["commands[70+]"]
    contributions --> configuration["configuration[3]"]
    
    dependencies --> aria_keys["Telemetry Keys"]
    dependencies --> activation_events["Activation Events"]
    dependencies --> enabled_apis["enabledApiProposals[30+]"]
```

### Language Model Tools Registry

The extension defines over 60 language model tools in the `languageModelTools` contribution point:

| Tool Category | Example Tools | Purpose |
|---------------|---------------|---------|
| Code Search | `copilot_searchCodebase`, `copilot_searchWorkspaceSymbols` | Search and indexing |
| File Operations | `copilot_readFile`, `copilot_createFile`, `copilot_applyPatch` | File manipulation |
| Terminal Operations | `copilot_runInTerminal`, `copilot_getTerminalOutput` | Command execution |
| Test Operations | `copilot_runTests`, `copilot_testFailure` | Testing workflows |
| Project Setup | `copilot_createNewWorkspace`, `copilot_createAndRunTask` | Project scaffolding |

Sources: [package.json:136-1217](), [package.json:1219-1284]()

## Build Configurations

The build system defines multiple build configurations through esbuild, each targeting a specific runtime environment with tailored optimization and bundling settings.

### esbuild Configuration Hierarchy

```mermaid
graph TB
    baseBuildOptions["baseBuildOptions"] --> baseNodeBuildOptions["baseNodeBuildOptions"]
    baseBuildOptions --> webBuildOptions["Web Build Options"]
    
    baseNodeBuildOptions --> nodeExtHostBuildOptions["nodeExtHostBuildOptions"]
    baseNodeBuildOptions --> nodeSimulationBuildOptions["nodeSimulationBuildOptions"]
    baseNodeBuildOptions --> nodeSimulationWorkbenchUIBuildOptions["nodeSimulationWorkbenchUIBuildOptions"]
    baseNodeBuildOptions --> nodeExtHostSimulationTestOptions["nodeExtHostSimulationTestOptions"]
    baseNodeBuildOptions --> typeScriptServerPluginBuildOptions["typeScriptServerPluginBuildOptions"]
    
    webBuildOptions --> webExtHostBuildOptions["webExtHostBuildOptions"]
    
    nodeExtHostBuildOptions --> dist_extension["dist/extension.js"]
    nodeExtHostBuildOptions --> dist_workers["dist/worker2.js, dist/tikTokenizerWorker.js"]
    nodeExtHostBuildOptions --> dist_tests["dist/test-extension.js"]
    
    webExtHostBuildOptions --> dist_web["dist/web.js"]
    
    nodeSimulationBuildOptions --> dist_sim["dist/simulationMain.js"]
    nodeSimulationWorkbenchUIBuildOptions --> dist_workbench["dist/simulationWorkbench.js"]
    nodeExtHostSimulationTestOptions --> sim_ext_dist[".vscode/extensions/test-extension/dist/simulation-extension.js"]
    
    typeScriptServerPluginBuildOptions --> ts_dist["node_modules/@vscode/copilot-typescript-server-plugin/dist/main.js"]
```

### Base Configuration Options

| Configuration | Purpose | Key Settings |
|---------------|---------|--------------|
| `baseBuildOptions` | Common settings for all builds | `bundle: true`, `treeShaking: true`, `minify: !isDev` |
| `baseNodeBuildOptions` | Node.js specific settings | `platform: 'node'`, extensive `external` dependencies |

Sources: [.esbuild.ts:18-49](), [.esbuild.ts:143-248]()

## Entry Points and Output Targets

The build system processes multiple entry points to generate bundles for different runtime environments and purposes.

### Node Extension Host Entry Points

| Entry Point | Output | Purpose |
|-------------|---------|---------|
| `src/extension/extension/vscode-node/extension.ts` | `dist/extension.js` | Main Node.js extension |
| `src/platform/parser/node/parserWorker.ts` | `dist/worker2.js` | Parser worker process |
| `src/platform/tokenizer/node/tikTokenizerWorker.ts` | `dist/tikTokenizerWorker.js` | Tokenizer worker |
| `src/platform/diff/node/diffWorkerMain.ts` | `dist/diffWorker.js` | Diff computation worker |
| `src/platform/tfidf/node/tfidfWorker.ts` | `dist/tfidfWorker.js` | TF-IDF calculation worker |
| `src/extension/onboardDebug/node/copilotDebugWorker/index.ts` | `dist/copilotDebugCommand.js` | Debug command worker |

### Web Extension Host Entry Points

| Entry Point | Output | Purpose |
|-------------|---------|---------|
| `src/extension/extension/vscode-worker/extension.ts` | `dist/web.js` | Web extension bundle |

### Simulation and Testing Entry Points

| Entry Point | Output | Purpose |
|-------------|---------|---------|
| `test/simulationMain.ts` | `dist/simulationMain.js` | Simulation test runner |
| `test/simulation/workbench/simulationWorkbench.tsx` | `dist/simulationWorkbench.js` | Workbench UI for simulation |
| `.vscode/extensions/test-extension/main.ts` | `.vscode/extensions/test-extension/dist/simulation-extension.js` | Test extension |

Sources: [.esbuild.ts:145-154](), [.esbuild.ts:166-168](), [.esbuild.ts:175-181](), [.esbuild.ts:185-187](), [.esbuild.ts:198-200]()

## Build Plugins

The build system uses custom esbuild plugins to handle special bundling requirements and dynamic module resolution.

### Test Bundle Plugin System

```mermaid
graph LR
    test_entry["test-extension.ts"] --> test_plugin["testBundlePlugin"]
    sanity_entry["sanity-test-extension.ts"] --> sanity_plugin["sanityTestBundlePlugin"]
    
    test_plugin --> resolve_tests["onResolve: /test-extension.ts$/"]
    test_plugin --> load_tests["onLoad: glob nodeExtHostTestGlobs"]
    
    sanity_plugin --> resolve_sanity["onResolve: /sanity-test-extension.ts$/"]
    sanity_plugin --> load_sanity["onLoad: glob nodeExtHostSanityTestGlobs"]
    
    load_tests --> generate_requires["Generate require() statements"]
    load_sanity --> generate_requires
    
    generate_requires --> bundle_output["Bundled test files"]
```

### VS Code Types Shim Plugin

The `shimVsCodeTypesPlugin` provides dynamic VS Code API resolution for different runtime environments:

```mermaid
graph TD
    vscode_import["import 'vscode'"] --> shim_plugin["shimVsCodeTypesPlugin"]
    shim_plugin --> resolve_vscode["onResolve: /^vscode$/"]
    resolve_vscode --> virtual_module["vscode-dynamic namespace"]
    
    virtual_module --> load_handler["onLoad: vscode-fallback"]
    load_handler --> runtime_check{"Runtime Environment Check"}
    
    runtime_check -->|Simulation| sim_vscode["COPILOT_SIMULATION_VSCODE"]
    runtime_check -->|Extension Host| eval_require["eval('require('vscode')')"]
    runtime_check -->|Test/Fallback| shim_types["vscodeTypesShim.ts"]
```

Sources: [.esbuild.ts:58-108](), [.esbuild.ts:110-141]()

## Development vs Production Builds

The build system supports different modes controlled by command-line arguments and environment variables, with distinct optimizations and package configurations.

### Build Mode Configuration

| Mode | Trigger | Key Differences |
|------|---------|----------------|
| Development | `--dev` flag | `minify: false`, `sourcemap: 'linked'`, includes `dotenv` and `source-map-support` |
| Production | Default | `minify: true`, `sourcemap: false`, excludes dev dependencies |
| Pre-release | `--prerelease` flag | Sets `isPreRelease: true` in package.json patch |

### Package.json Deployment Processing

The `applyPackageJsonPatch()` function transforms the package.json for production deployment:

```mermaid
graph LR
    package_json["package.json"] --> patch_fn["applyPackageJsonPatch()"]
    patch_fn --> add_props["Add buildType: 'prod'"]
    patch_fn --> add_prerelease["Add isPreRelease: boolean"]
    patch_fn --> remove_dev["Remove devDependencies"]
    patch_fn --> remove_scripts["Remove scripts"]
    patch_fn --> remove_deps["Remove dependencies"]
    patch_fn --> write_output["Write dist/package.json"]
    
    write_output --> vscode_package["VS Code Extension Package"]
```

### Build Type Configuration

The extension package.json contains build-specific metadata:

| Field | Development Value | Production Value |
|-------|-------------------|------------------|
| `buildType` | `"dev"` | `"prod"` |
| `build` | `"1"` | Build number |
| `isPreRelease` | Not set | `true` for pre-release builds |

Sources: [.esbuild.ts:14-16](), [.esbuild.ts:336-353](), [package.json:10-11]()

## Watch Mode and File Monitoring

The build system provides efficient file watching for development workflows using the `@parcel/watcher` library.

### Watch Mode Implementation

```mermaid
graph TD
    watch_flag["--watch flag"] --> create_contexts["Create esbuild.BuildContext[]"]
    create_contexts --> setup_watcher["watcher.subscribe(REPO_ROOT)"]
    
    setup_watcher --> file_change["File Change Event"]
    file_change --> debounce["Debounce 100ms"]
    debounce --> rebuild_fn["rebuild()"]
    
    rebuild_fn --> cancel_builds["ctx.cancel() for all contexts"]
    cancel_builds --> rebuild_all["ctx.rebuild() for all contexts"]
    
    setup_watcher --> ignore_patterns["Ignore Patterns"]
    ignore_patterns --> git_ignore["**/.git/**"]
    ignore_patterns --> dist_ignore["**/dist/**"]
    ignore_patterns --> node_modules["**/node_modules/**"]
    ignore_patterns --> test_artifacts["**/.simulation/**, **/test/outcome/**"]
```

### File Monitoring Configuration

The watcher ignores specific patterns to avoid unnecessary rebuilds:

| Pattern | Purpose |
|---------|---------|
| `**/.git/**` | Git repository files |
| `**/dist/**` | Build output directories |
| `**/node_modules/**` | Node.js dependencies |
| `**/.simulation/**` | Simulation test artifacts |
| `**/test/outcome/**` | Test result files |
| `**/*.sqlite*` | Database files |
| `**/*.txt`, `**/baseline*.json` | Test baseline files |

Sources: [.esbuild.ts:257-323](), [.esbuild.ts:279-298](), [.esbuild.ts:301-322]()

## TypeScript Server Plugin Build

The build system includes special handling for the TypeScript server plugin, which requires installation into the `node_modules` directory structure.

### Plugin Installation Process

```mermaid
graph LR
    plugin_build["TypeScript Plugin Build"] --> install_pkg["typeScriptServerPluginPackageJsonInstall()"]
    install_pkg --> create_dir["mkdir node_modules/@vscode/copilot-typescript-server-plugin"]
    create_dir --> copy_pkg["copyFile package.json"]
    
    plugin_build --> esbuild_plugin["esbuild.build(typeScriptServerPluginBuildOptions)"]
    esbuild_plugin --> entry_point["src/extension/typescriptContext/serverPlugin/src/node/main.ts"]
    entry_point --> output["node_modules/@vscode/copilot-typescript-server-plugin/dist/main.js"]
```

The plugin build configuration excludes TypeScript itself as an external dependency since it's provided by the TypeScript language server runtime.

Sources: [.esbuild.ts:219-228](), [.esbuild.ts:230-248]()