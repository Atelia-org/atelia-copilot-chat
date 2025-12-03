/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ChatLocation } from '../../../platform/chat/common/commonTypes';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { DisposableStore, IDisposable } from '../../../util/vs/base/common/lifecycle';
import { StopWatch } from '../../../util/vs/base/common/stopwatch';
import { IInstantiationService, ServicesAccessor } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { IConversationStore } from '../../conversationStore/node/conversationStore';
import { ChatVariablesCollection } from '../../prompt/common/chatVariablesCollection';
import { Conversation, normalizeSummariesOnRounds } from '../../prompt/common/conversation';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { IToolsService } from '../../tools/common/toolsService';
import { ConversationHistorySummarizer, createPromptSizingForDryRun, ensureSummarizationDebugFlagsExposed, SummarizationDebugFlags, SummarizedAgentHistoryProps, SummarizedConversationHistoryPropsBuilder } from '../node/agent/summarizedConversationHistory';

// Ensure debug flags are exposed to globalThis when this contribution loads
ensureSummarizationDebugFlagsExposed();

/**
 * Contribution that registers development/debugging commands for conversation summarization.
 *
 * Commands:
 * - `github.copilot.debug.dryRunSummarization`: Full dry-run with real conversation data + LLM call
 * - `github.copilot.debug.dryRunSummarizationMock`: Full dry-run with mock data + LLM call
 * - `github.copilot.debug.testPropsBuilder`: Test the PropsBuilder splitting logic only (mock data)
 * - `github.copilot.debug.inspectConversation`: Inspect the current active conversation structure
 */
class SummarizationDebugContribution implements IExtensionContribution {
	readonly id = 'summarization-debug';

	private readonly _disposables = new DisposableStore();
	private _outputChannel: vscode.LogOutputChannel | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@IConversationStore private readonly conversationStore: IConversationStore,
		@IToolsService private readonly toolsService: IToolsService,
	) {
		this._disposables.add(this.registerCommands());
	}

	private get outputChannel(): vscode.LogOutputChannel {
		if (!this._outputChannel) {
			this._outputChannel = vscode.window.createOutputChannel('Copilot Summarization Debug', { log: true });
		}
		return this._outputChannel;
	}

	private registerCommands(): IDisposable {
		return vscode.Disposable.from(
			vscode.commands.registerCommand('github.copilot.debug.dryRunSummarization', () => this.dryRunSummarizationReal()),
			vscode.commands.registerCommand('github.copilot.debug.dryRunSummarizationMock', () => this.dryRunSummarizationMock()),
			vscode.commands.registerCommand('github.copilot.debug.testPropsBuilder', () => this.testPropsBuilder()),
			vscode.commands.registerCommand('github.copilot.debug.inspectConversation', () => this.inspectConversation()),
			vscode.commands.registerCommand('github.copilot.debug.clearRoundSummary', () => this.clearRoundSummary()),
			vscode.commands.registerCommand('github.copilot.debug.toggleSummarizationToolInjection', () => this.toggleToolInjection()),
		);
	}

	/**
	 * Toggle whether tools are injected into summarization requests.
	 * This affects both dry-run and real summarization.
	 */
	private async toggleToolInjection(): Promise<void> {
		const outputChannel = this.outputChannel;
		outputChannel.show(true);

		const currentValue = SummarizationDebugFlags.injectTools;
		const items = [
			{ label: '✅ Enable tool injection', description: 'tools + tool_choice=none will be sent', value: true },
			{ label: '❌ Disable tool injection', description: 'No tools in request options', value: false },
		];

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: `Current: ${currentValue ? 'ENABLED' : 'DISABLED'} - Select new setting`,
			title: 'Toggle Summarization Tool Injection'
		});

		if (selected === undefined) {
			outputChannel.info('User cancelled.');
			return;
		}

		SummarizationDebugFlags.injectTools = selected.value;
		outputChannel.info(`=== Tool Injection ${selected.value ? 'ENABLED' : 'DISABLED'} ===`);
		outputChannel.info(`SummarizationDebugFlags.injectTools = ${selected.value}`);
		outputChannel.info('This affects both dry-run and real summarization.');
		outputChannel.info('');
		outputChannel.info('You can also toggle this in Developer Console:');
		outputChannel.info('  globalThis.__SUMMARIZATION_DEBUG_FLAGS__.injectTools = true/false');

		vscode.window.showInformationMessage(
			`Summarization tool injection: ${selected.value ? 'ENABLED' : 'DISABLED'}`
		);
	}

	/**
	 * Clear the summary property of a specific round to re-enable compression triggering.
	 */
	private async clearRoundSummary(): Promise<void> {
		this.logService.info('[SummarizationDebug] clearRoundSummary called');

		const outputChannel = this.outputChannel;
		outputChannel.show(true);

		const conversation = this.conversationStore.lastConversation;
		if (!conversation) {
			outputChannel.warn('No active conversation found.');
			vscode.window.showWarningMessage('No active conversation found. Start a chat first.');
			return;
		}

		// Collect all rounds with summaries
		const roundsWithSummary: { turnIndex: number; roundIndex: number; roundId: string; summaryPreview: string }[] = [];
		for (const [turnIdx, turn] of conversation.turns.entries()) {
			for (const [roundIdx, round] of turn.rounds.entries()) {
				if (round.summary) {
					roundsWithSummary.push({
						turnIndex: turnIdx,
						roundIndex: roundIdx,
						roundId: round.id,
						summaryPreview: round.summary.substring(0, 50) + (round.summary.length > 50 ? '...' : '')
					});
				}
			}
		}

		if (roundsWithSummary.length === 0) {
			outputChannel.info('No rounds with summaries found.');
			vscode.window.showInformationMessage('No rounds with summaries to clear.');
			return;
		}

		// Let user select which round to clear
		const items = roundsWithSummary.map(r => ({
			label: `Turn ${r.turnIndex}, Round ${r.roundIndex}`,
			description: r.roundId,
			detail: r.summaryPreview,
			roundId: r.roundId
		}));

		// Add "Clear All" option
		items.unshift({
			label: '🗑️ Clear ALL summaries',
			description: `${roundsWithSummary.length} rounds`,
			detail: 'This will clear all round summaries, allowing full re-compression',
			roundId: '__ALL__'
		});

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a round to clear its summary',
			title: 'Clear Round Summary'
		});

		if (!selected) {
			outputChannel.info('User cancelled.');
			return;
		}

		// Perform the clear
		let clearedCount = 0;
		for (const turn of conversation.turns) {
			for (const round of turn.rounds) {
				if (selected.roundId === '__ALL__' || round.id === selected.roundId) {
					if (round.summary) {
						round.summary = undefined;
						clearedCount++;
						outputChannel.info(`Cleared summary for round ${round.id}`);
					}
				}
			}
		}

		outputChannel.info(`=== Cleared ${clearedCount} round summary(ies) ===`);
		vscode.window.showInformationMessage(`Cleared ${clearedCount} round summary(ies). Compression can now be re-triggered.`);
	}

	/**
	 * Inspect the current active conversation structure without making any LLM calls.
	 */
	private async inspectConversation(): Promise<void> {
		this.logService.info('[SummarizationDebug] inspectConversation called');

		const outputChannel = this.outputChannel;
		outputChannel.show(true);
		outputChannel.info('');
		outputChannel.info('========================================');
		outputChannel.info('=== INSPECT ACTIVE CONVERSATION ===');
		outputChannel.info('========================================');

		const conversation = this.conversationStore.lastConversation;
		if (!conversation) {
			outputChannel.warn('No active conversation found in ConversationStore.');
			vscode.window.showWarningMessage('No active conversation found. Start a chat first.');
			return;
		}

		outputChannel.info(`Session ID: ${conversation.sessionId}`);
		outputChannel.info(`Total turns: ${conversation.turns.length}`);
		outputChannel.info('');

		// Enumerate turns and rounds
		let totalRounds = 0;
		for (const [i, turn] of conversation.turns.entries()) {
			const request = turn.request;
			const requestPreview = request.message.length > 100 ? request.message.substring(0, 100) + '...' : request.message;
			outputChannel.info(`Turn ${i}: "${requestPreview}"`);
			outputChannel.info(`  Status: ${turn.responseStatus}`);
			outputChannel.info(`  Rounds: ${turn.rounds.length}`);

			for (const [j, round] of turn.rounds.entries()) {
				const toolNames = round.toolCalls.map(tc => tc.name).join(', ') || '(no tools)';
				const hasSummary = round.summary ? 'YES' : 'no';
				outputChannel.info(`    Round ${j}: id=${round.id}, tools=[${toolNames}], summary=${hasSummary}`);
				totalRounds++;
			}
		}

		outputChannel.info('');
		outputChannel.info(`Total rounds across all turns: ${totalRounds}`);
		outputChannel.info('');
		outputChannel.info('=== INSPECTION COMPLETE ===');
		vscode.window.showInformationMessage(`Conversation has ${conversation.turns.length} turns and ${totalRounds} rounds. Check output.`);
	}

	/**
	 * Full dry-run using REAL conversation data from ConversationStore.
	 * This is the primary debugging command for half-context compression.
	 */
	private async dryRunSummarizationReal(): Promise<void> {
		this.logService.info('[SummarizationDebug] dryRunSummarizationReal called');

		const outputChannel = this.outputChannel;
		outputChannel.show(true);
		outputChannel.info('');
		outputChannel.info('=============================================');
		outputChannel.info('=== DRY-RUN SUMMARIZATION (REAL CONTEXT) ===');
		outputChannel.info('=============================================');

		const conversation = this.conversationStore.lastConversation;
		if (!conversation) {
			outputChannel.warn('No active conversation found in ConversationStore.');
			vscode.window.showWarningMessage('No active conversation found. Start a chat first.');
			return;
		}

		// Get all available endpoints for selection
		const allEndpoints = await this.endpointProvider.getAllChatEndpoints();
		const endpointItems = allEndpoints.map(ep => ({
			label: ep.model,
			description: `family: ${ep.family}, maxTokens: ${ep.modelMaxPromptTokens}`,
			endpoint: ep,
		}));

		// Put gpt-4.1 first as default, then sort alphabetically
		endpointItems.sort((a, b) => {
			if (a.label === 'gpt-4.1') {
				return -1;
			}
			if (b.label === 'gpt-4.1') {
				return 1;
			}
			return a.label.localeCompare(b.label);
		});

		const endpointChoice = await vscode.window.showQuickPick(endpointItems, {
			placeHolder: 'Select model endpoint for summarization test',
			title: 'Dry-Run Summarization - Select Endpoint'
		});

		if (!endpointChoice) {
			outputChannel.info('User cancelled endpoint selection.');
			return;
		}

		outputChannel.info(`Using conversation: ${conversation.sessionId}`);
		outputChannel.info(`Turns: ${conversation.turns.length}`);
		outputChannel.info(`Selected endpoint: ${endpointChoice.label}`);

		// Normalize summaries on rounds (same as real flow)
		normalizeSummariesOnRounds(conversation.turns);

		// Build real IBuildPromptContext from the conversation
		const realPromptContext = this.buildPromptContextFromConversation(conversation);
		await this.executeDryRun(realPromptContext, 'REAL', endpointChoice.endpoint);
	}

	/**
	 * Full dry-run using MOCK data (for testing when no real conversation exists).
	 */
	private async dryRunSummarizationMock(): Promise<void> {
		this.logService.info('[SummarizationDebug] dryRunSummarizationMock called');

		const outputChannel = this.outputChannel;
		outputChannel.show(true);
		outputChannel.info('');
		outputChannel.info('=============================================');
		outputChannel.info('=== DRY-RUN SUMMARIZATION (MOCK CONTEXT) ===');
		outputChannel.info('=============================================');

		const mockPromptContext = this.createMockPromptContext();
		await this.executeDryRun(mockPromptContext, 'MOCK');
	}

	/**
	 * Build IBuildPromptContext from a real Conversation object.
	 *
	 * IMPORTANT: Must include a `tools` object even if empty, otherwise ChatToolCalls
	 * component won't render any tool call rounds (it returns early if !promptContext.tools).
	 */
	private buildPromptContextFromConversation(conversation: Conversation): IBuildPromptContext {
		// Get latest turn for current query
		const latestTurn = conversation.getLatestTurn();
		const availableTools = this.getAvailableToolsForSummarization();

		return {
			query: latestTurn.request.message,
			history: conversation.turns.slice(0, -1), // All turns except latest (latest is "current")
			chatVariables: latestTurn.promptVariables ?? new ChatVariablesCollection(),
			toolCallRounds: latestTurn.rounds.length > 0 ? latestTurn.rounds : undefined,
			toolCallResults: latestTurn.resultMetadata?.toolCallResults,
			conversation,
			isContinuation: false,
			// Stub tools object to enable ChatToolCalls rendering.
			// The actual tool invocation token is not needed for summarization (we just render history).
			tools: {
				toolReferences: [],
				toolInvocationToken: undefined!, // Not used during summarization rendering
				availableTools,
			},
		};
	}

	/**
	 * Shared dry-run execution logic.
	 * Now uses ConversationHistorySummarizer directly for 100% code path alignment with real summarization.
	 */
	private async executeDryRun(promptContext: IBuildPromptContext, contextType: 'REAL' | 'MOCK', endpointOverride?: IChatEndpoint): Promise<void> {
		const outputChannel = this.outputChannel;

		try {
			// Use specified endpoint or default to gpt-4.1 for stability
			const endpoint = endpointOverride ?? await this.endpointProvider.getChatEndpoint('gpt-4.1');
			outputChannel.info(`Using endpoint: ${endpoint.model}`);

			// Log debug flags state
			outputChannel.info(`SummarizationDebugFlags.injectTools: ${SummarizationDebugFlags.injectTools}`);
			outputChannel.info(`SummarizationDebugFlags.verboseLogging: ${SummarizationDebugFlags.verboseLogging}`);

			const availableTools = promptContext.tools?.availableTools ?? this.getAvailableToolsForSummarization();
			outputChannel.info(`Available tools for summarization: ${availableTools.length}`);
			const props: SummarizedAgentHistoryProps = {
				priority: 100,
				endpoint,
				location: ChatLocation.Panel,
				promptContext,
				maxToolResultLength: 10000,
				tools: availableTools,
			};

			// Log input context stats
			outputChannel.info('');
			outputChannel.info(`=== Input Context (${contextType}) ===`);
			outputChannel.info(`History turns: ${promptContext.history.length}`);
			outputChannel.info(`Current toolCallRounds: ${promptContext.toolCallRounds?.length ?? 0}`);

			let totalRounds = 0;
			for (const [i, turn] of promptContext.history.entries()) {
				outputChannel.info(`  Turn ${i}: ${turn.rounds.length} rounds`);
				for (const [j, round] of turn.rounds.entries()) {
					const hasSummary = round.summary ? 'YES' : 'no';
					outputChannel.info(`    Round ${j}: id=${round.id}, summary=${hasSummary}`);
					totalRounds++;
				}
			}
			for (const [j, round] of (promptContext.toolCallRounds ?? []).entries()) {
				const hasSummary = round.summary ? 'YES' : 'no';
				outputChannel.info(`  Current Round ${j}: id=${round.id}, summary=${hasSummary}`);
				totalRounds++;
			}
			outputChannel.info(`Total rounds: ${totalRounds}`);

			// Create PromptSizing for dry-run
			const sizing = createPromptSizingForDryRun(endpoint);
			outputChannel.info(`PromptSizing tokenBudget: ${sizing.tokenBudget}`);

			// Create ConversationHistorySummarizer (same as real flow!)
			outputChannel.info('');
			outputChannel.info('=== Using ConversationHistorySummarizer (same as real flow) ===');
			const summarizer = this.instantiationService.createInstance(
				ConversationHistorySummarizer,
				props,
				sizing,
				undefined, // no progress reporting for dry-run
				CancellationToken.None,
			);

			const stopwatch = new StopWatch(false);

			try {
				// Call summarizeHistory() - this is the EXACT same code path as real summarization!
				const result = await summarizer.summarizeHistory();

				outputChannel.info(`Request completed in ${stopwatch.elapsed()}ms`);
				outputChannel.info(`toolCallRoundId: ${result.toolCallRoundId}`);

				outputChannel.info('');
				outputChannel.info('=== LLM Response (Summary) ===');
				outputChannel.info(`Length: ${result.summary.length} chars`);

				if (result.summary.length === 0) {
					outputChannel.warn('⚠️ WARNING: LLM returned EMPTY response!');
					outputChannel.warn('This is the bug we are debugging.');
					outputChannel.warn(`Tool injection was: ${SummarizationDebugFlags.injectTools ? 'ENABLED' : 'DISABLED'}`);
				}

				outputChannel.info('--- BEGIN SUMMARY ---');
				const lines = result.summary.split('\n');
				for (const line of lines) {
					outputChannel.info(line);
				}
				outputChannel.info('--- END SUMMARY ---');

				outputChannel.info('');
				outputChannel.info(`=== DRY-RUN SUCCESS (${contextType}) ===`);
				outputChannel.info('NOTE: Summary was NOT written to round.summary (dry-run mode)');

				vscode.window.showInformationMessage(
					`Dry-run (${contextType}) completed! Summary: ${result.summary.length} chars. Check output.`
				);
			} catch (e) {
				const err = e as Error;
				outputChannel.error(`Summarization failed: ${err.message}`);
				outputChannel.error(`Stack: ${err.stack}`);

				// Check if it's a "nothing to summarize" error
				if (err.message.includes('Nothing to summarize')) {
					outputChannel.error('This means there are not enough unsummarized rounds to trigger summarization.');
					vscode.window.showErrorMessage(`Nothing to summarize. Need at least 2 unsummarized rounds.`);
				} else {
					vscode.window.showErrorMessage(`Summarization failed: ${err.message}`);
				}
			}

		} catch (error) {
			const err = error as Error;
			outputChannel.error(`Unexpected error: ${err.message}`);
			outputChannel.error(`Stack: ${err.stack}`);
			vscode.window.showErrorMessage(`Dry-run failed: ${err.message}`);
		}
	}

	/**
	 * Test only the PropsBuilder splitting logic (no LLM call).
	 */
	private async testPropsBuilder(): Promise<void> {
		this.logService.info('[SummarizationDebug] testPropsBuilder called');

		const outputChannel = this.outputChannel;
		outputChannel.show(true);

		try {
			// Create a mock promptContext with multiple turns and rounds
			const mockPromptContext = this.createMockPromptContext();

			outputChannel.info('=== Mock Prompt Context Created ===');
			outputChannel.info(`History turns: ${mockPromptContext.history.length}`);
			outputChannel.info(`Current toolCallRounds: ${mockPromptContext.toolCallRounds?.length ?? 0}`);

			// Enumerate all rounds
			let totalRounds = 0;
			for (const [i, turn] of mockPromptContext.history.entries()) {
				outputChannel.info(`  Turn ${i}: ${turn.rounds.length} rounds`);
				for (const [j, round] of turn.rounds.entries()) {
					outputChannel.info(`    Round ${j}: id=${round.id}, summary=${round.summary ? 'YES' : 'no'}`);
					totalRounds++;
				}
			}
			for (const [j, round] of (mockPromptContext.toolCallRounds ?? []).entries()) {
				outputChannel.info(`  Current Round ${j}: id=${round.id}, summary=${round.summary ? 'YES' : 'no'}`);
				totalRounds++;
			}
			outputChannel.info(`Total rounds: ${totalRounds}`);

			// Get endpoint for props
			const endpoint = await this.endpointProvider.getChatEndpoint('gpt-4.1');

			// Create mock props
			const mockProps: SummarizedAgentHistoryProps = {
				priority: 100,
				endpoint,
				location: ChatLocation.Panel,
				promptContext: mockPromptContext,
				maxToolResultLength: 10000,
			};

			// Call the PropsBuilder
			outputChannel.info('');
			outputChannel.info('=== Calling SummarizedConversationHistoryPropsBuilder.getProps() ===');

			const propsBuilder = this.instantiationService.createInstance(SummarizedConversationHistoryPropsBuilder);
			const result = propsBuilder.getProps(mockProps);

			outputChannel.info('');
			outputChannel.info('=== Result ===');
			outputChannel.info(`summarizedToolCallRoundId: ${result.summarizedToolCallRoundId}`);
			outputChannel.info(`result.props.promptContext.history.length: ${result.props.promptContext.history.length}`);
			outputChannel.info(`result.props.promptContext.toolCallRounds?.length: ${result.props.promptContext.toolCallRounds?.length ?? 0}`);
			outputChannel.info(`result.props.promptContext.isContinuation: ${result.props.promptContext.isContinuation}`);

			// Show which rounds are in the virtual context
			outputChannel.info('');
			outputChannel.info('=== Virtual Context Rounds ===');
			for (const [i, turn] of result.props.promptContext.history.entries()) {
				outputChannel.info(`  Virtual Turn ${i}: ${turn.rounds.length} rounds`);
				for (const [j, round] of turn.rounds.entries()) {
					outputChannel.info(`    Round ${j}: id=${round.id}`);
				}
			}
			for (const [j, round] of (result.props.promptContext.toolCallRounds ?? []).entries()) {
				outputChannel.info(`  Virtual Current Round ${j}: id=${round.id}`);
			}

			outputChannel.info('');
			outputChannel.info('=== SUCCESS ===');
			vscode.window.showInformationMessage(`PropsBuilder test completed. Check "Copilot Summarization Debug" output.`);

		} catch (error) {
			const err = error as Error;
			outputChannel.error(`Error: ${err.message}`);
			outputChannel.error(`Stack: ${err.stack}`);
			vscode.window.showErrorMessage(`PropsBuilder test failed: ${err.message}`);
		}
	}

	/**
	 * Create a mock prompt context for testing.
	 * Simulates a conversation with 3 turns, each with 2 rounds.
	 */
	private createMockPromptContext(): IBuildPromptContext {
		const createRound = (id: string, summary?: string) => ({
			id,
			response: `Response for ${id}`,
			toolCalls: [{ id: `tc-${id}`, name: 'read_file', arguments: '{"path": "/test.txt"}' }],
			summary,
		});

		const createTurn = (turnId: string, roundIds: string[]) => ({
			id: turnId,
			request: { type: 'user' as const, message: `Mock request for ${turnId}` },
			toolReferences: [],
			promptVariables: undefined,
			editedFileEvents: undefined,
			rounds: roundIds.map(id => createRound(id)),
			get resultMetadata() { return undefined; },
			get responseChatResult() { return undefined; },
			getMetadata: () => undefined,
			getAllMetadata: () => undefined,
			setMetadata: () => undefined,
		});

		// Create mock turns with rounds
		const mockTurns = [
			createTurn('turn0', ['turn0-round0', 'turn0-round1']),
			createTurn('turn1', ['turn1-round0', 'turn1-round1']),
			createTurn('turn2', ['turn2-round0', 'turn2-round1']),
		];

		// Current turn's tool call rounds
		const currentRounds = [
			createRound('current-round0'),
			createRound('current-round1'),
		];

		const availableTools = this.getAvailableToolsForSummarization();
		const chatVariables = new ChatVariablesCollection();

		return {
			query: 'Mock summarization request',
			history: mockTurns as any,
			chatVariables,
			toolCallRounds: currentRounds as any,
			isContinuation: false,
			tools: {
				toolReferences: [],
				toolInvocationToken: undefined!,
				availableTools,
			},
		} as IBuildPromptContext;
	}

	private getAvailableToolsForSummarization(): readonly vscode.LanguageModelToolInformation[] {
		return this.toolsService.tools;
	}

	dispose(): void {
		this._outputChannel?.dispose();
		this._disposables.dispose();
	}
}

export function create(accessor: ServicesAccessor): IDisposable {
	const instantiationService = accessor.get(IInstantiationService);
	return instantiationService.createInstance(SummarizationDebugContribution);
}
