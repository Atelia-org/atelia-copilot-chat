/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Raw } from '@vscode/prompt-tsx';
import { ChatFetchResponseType, ChatLocation } from '../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { DisposableStore, IDisposable } from '../../../util/vs/base/common/lifecycle';
import { StopWatch } from '../../../util/vs/base/common/stopwatch';
import { ServicesAccessor, IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { IConversationStore } from '../../conversationStore/node/conversationStore';
import { ToolCallingLoop } from '../../intents/node/toolCallingLoop';
import { ChatVariablesCollection } from '../../prompt/common/chatVariablesCollection';
import { Conversation, normalizeSummariesOnRounds } from '../../prompt/common/conversation';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { renderPromptElement } from '../node/base/promptRenderer';
import { ConversationHistorySummarizationPrompt, SummarizedConversationHistoryPropsBuilder, SummarizedAgentHistoryProps } from '../node/agent/summarizedConversationHistory';

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
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IConversationStore private readonly conversationStore: IConversationStore,
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
		);
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

		outputChannel.info(`Using conversation: ${conversation.sessionId}`);
		outputChannel.info(`Turns: ${conversation.turns.length}`);

		// Normalize summaries on rounds (same as real flow)
		normalizeSummariesOnRounds(conversation.turns);

		// Build real IBuildPromptContext from the conversation
		const realPromptContext = this.buildPromptContextFromConversation(conversation);
		await this.executeDryRun(realPromptContext, 'REAL');
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
				toolInvocationToken: undefined as any, // Not used during summarization rendering
				availableTools: [],
			},
		};
	}

	/**
	 * Shared dry-run execution logic.
	 */
	private async executeDryRun(promptContext: IBuildPromptContext, contextType: 'REAL' | 'MOCK'): Promise<void> {
		const outputChannel = this.outputChannel;

		try {
			// Use the same endpoint as real summarization flow
			const endpoint = await this.endpointProvider.getChatEndpoint('gpt-4.1');

			const props: SummarizedAgentHistoryProps = {
				priority: 100,
				endpoint,
				location: ChatLocation.Panel,
				promptContext,
				maxToolResultLength: 10000,
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

			// Step 1: PropsBuilder
			outputChannel.info('');
			outputChannel.info('=== Step 1: PropsBuilder.getProps() ===');
			const propsBuilder = this.instantiationService.createInstance(SummarizedConversationHistoryPropsBuilder);

			let propsInfo;
			try {
				propsInfo = propsBuilder.getProps(props);
			} catch (e) {
				const err = e as Error;
				outputChannel.error(`PropsBuilder.getProps() threw: ${err.message}`);
				outputChannel.error(`This likely means there's nothing to summarize (<=1 unsummarized rounds).`);
				vscode.window.showErrorMessage(`PropsBuilder failed: ${err.message}`);
				return;
			}

			outputChannel.info(`summarizedToolCallRoundId: ${propsInfo.summarizedToolCallRoundId}`);
			outputChannel.info(`Virtual history turns: ${propsInfo.props.promptContext.history.length}`);
			outputChannel.info(`Virtual toolCallRounds: ${propsInfo.props.promptContext.toolCallRounds?.length ?? 0}`);
			outputChannel.info(`isContinuation: ${propsInfo.props.promptContext.isContinuation}`);

			// Step 2: Render prompt
			outputChannel.info('');
			outputChannel.info('=== Step 2: Render Summarization Prompt ===');
			const stopwatch = new StopWatch(false);

			const forceMode = this.configurationService.getConfig<string | undefined>(ConfigKey.Internal.AgentHistorySummarizationMode);
			const simpleMode = forceMode === 'simple';
			outputChannel.info(`Mode: ${simpleMode ? 'Simple' : 'Full'} (forceMode config: ${forceMode ?? 'not set'})`);

			let summarizationPrompt: Raw.ChatMessage[];
			try {
				const renderResult = await renderPromptElement(
					this.instantiationService,
					endpoint,
					ConversationHistorySummarizationPrompt,
					{ ...propsInfo.props, simpleMode },
					undefined,
					CancellationToken.None
				);
				summarizationPrompt = renderResult.messages;
				outputChannel.info(`Prompt rendered in ${stopwatch.elapsed()}ms`);
				outputChannel.info(`Message count: ${summarizationPrompt.length}`);
				outputChannel.info(`Token count: ${renderResult.tokenCount}`);

				// Log prompt structure
				outputChannel.info('');
				outputChannel.info('=== Prompt Structure ===');
				for (const [i, msg] of summarizationPrompt.entries()) {
					const roleStr = msg.role === 0 ? 'system' : msg.role === 1 ? 'user' : msg.role === 2 ? 'assistant' : `role=${msg.role}`;
					const contentPreview = this.getContentPreview(msg.content, 200);
					outputChannel.info(`  [${i}] ${roleStr}, content length=${this.getContentLength(msg.content)} chars`);
					outputChannel.info(`      preview: ${contentPreview}`);
				}
			} catch (e) {
				const err = e as Error;
				outputChannel.error(`Failed to render prompt: ${err.message}`);
				outputChannel.error(`Stack: ${err.stack}`);
				vscode.window.showErrorMessage(`Prompt render failed: ${err.message}`);
				return;
			}

			// Step 3: LLM call
			outputChannel.info('');
			outputChannel.info('=== Step 3: LLM Request ===');
			outputChannel.info(`Endpoint: ${endpoint.model}`);
			outputChannel.info('Sending request to LLM...');

			try {
				const summaryResponse = await endpoint.makeChatRequest2({
					debugName: `dryRunSummarization-${contextType}-${simpleMode ? 'simple' : 'full'}`,
					messages: ToolCallingLoop.stripInternalToolCallIds(summarizationPrompt),
					finishedCb: undefined,
					location: ChatLocation.Other,
					requestOptions: {
						temperature: 0,
						stream: false,
					},
					enableRetryOnFilter: true
				}, CancellationToken.None);

				outputChannel.info(`Request completed in ${stopwatch.elapsed()}ms`);
				outputChannel.info(`Response type: ${summaryResponse.type}`);

				if (summaryResponse.type === ChatFetchResponseType.Success) {
					outputChannel.info(`RequestId: ${summaryResponse.requestId}`);
					if (summaryResponse.usage) {
						outputChannel.info(`Usage: prompt_tokens=${summaryResponse.usage.prompt_tokens}, completion_tokens=${summaryResponse.usage.completion_tokens}`);
					}

					outputChannel.info('');
					outputChannel.info('=== LLM Response (Summary) ===');
					outputChannel.info(`Length: ${summaryResponse.value.length} chars`);

					if (summaryResponse.value.length === 0) {
						outputChannel.warn('⚠️ WARNING: LLM returned EMPTY response!');
						outputChannel.warn('This is the bug we are debugging.');
					}

					outputChannel.info('--- BEGIN SUMMARY ---');
					const lines = summaryResponse.value.split('\n');
					for (const line of lines) {
						outputChannel.info(line);
					}
					outputChannel.info('--- END SUMMARY ---');

					outputChannel.info('');
					outputChannel.info(`=== DRY-RUN SUCCESS (${contextType}) ===`);
					outputChannel.info('NOTE: Summary was NOT written to round.summary (dry-run mode)');

					vscode.window.showInformationMessage(
						`Dry-run (${contextType}) completed! Summary: ${summaryResponse.value.length} chars. Check output.`
					);
				} else {
					outputChannel.warn(`Response failed: ${summaryResponse.type}`);
					if ('reason' in summaryResponse) {
						outputChannel.warn(`Reason: ${(summaryResponse as any).reason}`);
					}
					vscode.window.showWarningMessage(`LLM request returned: ${summaryResponse.type}`);
				}
			} catch (e) {
				const err = e as Error;
				outputChannel.error(`LLM request failed: ${err.message}`);
				outputChannel.error(`Stack: ${err.stack}`);
				vscode.window.showErrorMessage(`LLM request failed: ${err.message}`);
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
	 * Get a preview of message content for logging.
	 */
	private getContentPreview(content: Raw.ChatCompletionContentPart[], maxLength: number): string {
		let text = '';
		for (const part of content) {
			if (part.type === Raw.ChatCompletionContentPartKind.Text) {
				text += part.text;
			} else {
				text += `[${part.type}]`;
			}
			if (text.length > maxLength) {
				return text.substring(0, maxLength) + '...';
			}
		}
		return text.substring(0, maxLength);
	}

	/**
	 * Get total character length of message content.
	 */
	private getContentLength(content: Raw.ChatCompletionContentPart[]): number {
		let length = 0;
		for (const part of content) {
			if (part.type === Raw.ChatCompletionContentPartKind.Text) {
				length += part.text.length;
			}
		}
		return length;
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

		return {
			history: mockTurns as any,
			toolCallRounds: currentRounds as any,
			isContinuation: false,
		} as IBuildPromptContext;
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
