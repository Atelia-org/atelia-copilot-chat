# 半窗口压缩方案 A：Builder 切片（改进版 v2）

## 修订背景

本文档是对原"半窗口压缩方案 A：Builder 切片"的改进修订版。根据评估反馈，原方案存在以下关键问题需要解决：

1. **深拷贝的正确性与完整性**：`JSON.parse(JSON.stringify())` 无法正确处理 `ResourceMap`、类实例原型链等复杂类型
2. **history-only 场景的 Turn 分裂复杂度**：Turn 的 `rounds` 是 getter 计算属性，内部切分困难
3. **summary 边界跨越的 fallback 策略不清晰**
4. **性能开销评估不足**

---

## 一、设计原则

### 1.1 结构共享优先，避免深拷贝

**核心洞察**：summarizer 只需要*读取*旧半区的数据来生成摘要，不需要修改它们。因此我们采用"视图模式"而非"副本模式"。

```
原始方案：完整深拷贝 IBuildPromptContext → 导致类型丢失、性能问题
改进方案：创建轻量级 SummarizerView → 只包含 summarizer 需要的只读引用
```

### 1.2 只在 Turn 边界切分

**简化策略**：不在 Turn 内部切分 rounds，而是将完整的 Turn 划分到"压缩区"或"保留区"。当最后一个 Turn 横跨边界时，整个 Turn 保留在"保留区"，由其第一个 round 携带 summary。

### 1.3 明确的 Fallback 层级

```
Level 0: 正常半窗口压缩
Level 1: 不足以切分 → 退回单轮压缩（现有逻辑）
Level 2: 存在 summary 边界冲突 → 跳过压缩，记录 telemetry
Level 3: 无可压缩内容 → 抛出 Error('Nothing to summarize')
```

---

## 二、核心数据结构

### 2.1 RoundCursor（轮次游标）

```typescript
interface RoundCursor {
  /** 来源：历史 turn 还是当前活跃 turn */
  readonly source: 'history' | 'active';
  /** 在 history 数组中的索引，active 时为 -1 */
  readonly turnIndex: number;
  /** 在 turn.rounds 或 toolCallRounds 中的索引 */
  readonly roundIndex: number;
  /** round 的只读引用（不拷贝） */
  readonly round: IToolCallRound;
  /** 关联的 Turn 对象引用（history 来源时） */
  readonly turn?: Turn;
}
```

### 2.2 SummarizerView（压缩器视图）

这是提供给 summarizer 的轻量级只读视图，**不是** `IBuildPromptContext` 的深拷贝。

```typescript
interface ISummarizerView {
  /** 需要压缩的 rounds（只读引用数组） */
  readonly roundsToSummarize: readonly RoundCursor[];
  /** 原始 promptContext 的只读引用（用于访问 chatVariables 等共享数据） */
  readonly originalContext: Readonly<IBuildPromptContext>;
  /** 压缩统计信息 */
  readonly stats: CompressionStats;
}

interface CompressionStats {
  readonly mode: 'half-window' | 'single-round' | 'fallback';
  readonly totalRoundCount: number;
  readonly summarizedRoundCount: number;
  readonly keptRoundCount: number;
  readonly splitStrategy: 'turn-boundary' | 'active-only' | 'none';
  readonly fallbackReason?: CompressionFallbackReason;
}

type CompressionFallbackReason =
  | 'not-enough-rounds'      // 总 round 数不足以进行半窗口切分
  | 'summary-boundary'       // 已有 summary 阻止了切分
  | 'single-turn-only'       // 只有一个 turn，使用现有逻辑
  | 'active-rounds-only';    // 只有活跃 rounds，使用现有逻辑
```

### 2.3 HalfWindowCompressionResult

```typescript
interface IHalfWindowCompressionResult {
  /** 给 summarizer prompt 使用的视图 */
  readonly summarizerView: ISummarizerView;
  /** 需要标记 summary 的 round id */
  readonly summarizedToolCallRoundId: string;
  /** 修改后的 promptContext（toolCallRounds 可能被截断） */
  readonly modifiedPromptContext: IBuildPromptContext;
  /** 是否使用了 fallback 逻辑 */
  readonly usedFallback: boolean;
}
```

---

## 三、核心算法

### 3.1 collectRounds：统一展开所有轮次

```typescript
/**
 * 按时间顺序（旧→新）收集所有 rounds，遇到已有 summary 时停止。
 * 不进行任何拷贝，只创建游标引用。
 */
function collectRounds(promptContext: IBuildPromptContext): RoundCursor[] {
  const cursors: RoundCursor[] = [];

  // 1. 遍历历史 turns（旧→新）
  for (let turnIndex = 0; turnIndex < promptContext.history.length; turnIndex++) {
    const turn = promptContext.history[turnIndex];
    const rounds = turn.rounds;  // getter，每次调用都会计算

    for (let roundIndex = 0; roundIndex < rounds.length; roundIndex++) {
      const round = rounds[roundIndex];

      // 遇到已有 summary，立即停止（这之前的内容已被压缩）
      if (round.summary) {
        return cursors;  // 返回空或部分结果，表示有 summary 边界
      }

      cursors.push({
        source: 'history',
        turnIndex,
        roundIndex,
        round,
        turn
      });
    }
  }

  // 2. 遍历活跃 toolCallRounds（旧→新）
  const activeRounds = promptContext.toolCallRounds ?? [];
  for (let roundIndex = 0; roundIndex < activeRounds.length; roundIndex++) {
    const round = activeRounds[roundIndex];

    if (round.summary) {
      return cursors;
    }

    cursors.push({
      source: 'active',
      turnIndex: -1,
      roundIndex,
      round,
      turn: undefined
    });
  }

  return cursors;
}
```

### 3.2 calculateHalfWindowSplit：计算切分点

```typescript
const MIN_OVERLAP = 1;  // 最少保留的 verbatim rounds
const MIN_ROUNDS_FOR_HALF_WINDOW = 4;  // 至少需要 4 个 rounds 才启用半窗口

interface SplitDecision {
  readonly strategy: 'half-window' | 'single-round' | 'fallback-existing';
  readonly keepCount: number;
  readonly summarizeCount: number;
  readonly splitCursorIndex: number;  // cursors 数组中的切分索引
  readonly fallbackReason?: CompressionFallbackReason;
}

function calculateHalfWindowSplit(cursors: RoundCursor[]): SplitDecision {
  const N = cursors.length;

  // Case 1: rounds 数量不足
  if (N < MIN_ROUNDS_FOR_HALF_WINDOW) {
    return {
      strategy: 'fallback-existing',
      keepCount: N,
      summarizeCount: 0,
      splitCursorIndex: 0,
      fallbackReason: 'not-enough-rounds'
    };
  }

  // Case 2: 计算半窗口切分点
  const idealKeepCount = Math.ceil(N / 2);
  const keepCount = Math.max(MIN_OVERLAP + 1, idealKeepCount);
  const summarizeCount = N - keepCount;

  if (summarizeCount <= 0) {
    return {
      strategy: 'fallback-existing',
      keepCount: N,
      summarizeCount: 0,
      splitCursorIndex: 0,
      fallbackReason: 'not-enough-rounds'
    };
  }

  // splitCursorIndex 指向第一个被保留的 cursor
  const splitCursorIndex = summarizeCount;

  return {
    strategy: 'half-window',
    keepCount,
    summarizeCount,
    splitCursorIndex,
    fallbackReason: undefined
  };
}
```

### 3.3 adjustToTurnBoundary：调整到 Turn 边界

**关键简化**：不在 Turn 内部切分，而是将切分点调整到最近的 Turn 边界。

```typescript
interface TurnBoundaryAdjustment {
  readonly adjustedSplitIndex: number;
  readonly adjustedKeepCount: number;
  readonly adjustedSummarizeCount: number;
  readonly boundaryType: 'exact' | 'adjusted-to-turn-start' | 'adjusted-to-turn-end';
}

function adjustToTurnBoundary(
  cursors: RoundCursor[],
  splitCursorIndex: number
): TurnBoundaryAdjustment {
  if (splitCursorIndex <= 0 || splitCursorIndex >= cursors.length) {
    return {
      adjustedSplitIndex: splitCursorIndex,
      adjustedKeepCount: cursors.length - splitCursorIndex,
      adjustedSummarizeCount: splitCursorIndex,
      boundaryType: 'exact'
    };
  }

  const cursorAtSplit = cursors[splitCursorIndex];
  const cursorBeforeSplit = cursors[splitCursorIndex - 1];

  // Case 1: 切分点已经在 Turn 边界（不同 turn 或 active/history 边界）
  if (cursorAtSplit.turnIndex !== cursorBeforeSplit.turnIndex ||
      cursorAtSplit.source !== cursorBeforeSplit.source) {
    return {
      adjustedSplitIndex: splitCursorIndex,
      adjustedKeepCount: cursors.length - splitCursorIndex,
      adjustedSummarizeCount: splitCursorIndex,
      boundaryType: 'exact'
    };
  }

  // Case 2: 切分点在 Turn 内部，需要调整
  // 策略：向前调整到当前 Turn 的开始（保留更多内容）
  let adjustedIndex = splitCursorIndex;
  while (adjustedIndex > 0) {
    const prev = cursors[adjustedIndex - 1];
    if (prev.turnIndex !== cursorAtSplit.turnIndex || prev.source !== cursorAtSplit.source) {
      break;
    }
    adjustedIndex--;
  }

  // 如果调整后 summarizeCount 为 0，尝试向后调整到下一个 Turn 开始
  if (adjustedIndex === 0) {
    adjustedIndex = splitCursorIndex;
    while (adjustedIndex < cursors.length - MIN_OVERLAP - 1) {
      const next = cursors[adjustedIndex];
      const nextAfter = cursors[adjustedIndex + 1];
      if (!nextAfter || next.turnIndex !== nextAfter.turnIndex || next.source !== nextAfter.source) {
        adjustedIndex++;
        break;
      }
      adjustedIndex++;
    }

    return {
      adjustedSplitIndex: adjustedIndex,
      adjustedKeepCount: cursors.length - adjustedIndex,
      adjustedSummarizeCount: adjustedIndex,
      boundaryType: 'adjusted-to-turn-end'
    };
  }

  return {
    adjustedSplitIndex: adjustedIndex,
    adjustedKeepCount: cursors.length - adjustedIndex,
    adjustedSummarizeCount: adjustedIndex,
    boundaryType: 'adjusted-to-turn-start'
  };
}
```

### 3.4 buildSummarizerView：构建 Summarizer 视图

```typescript
function buildSummarizerView(
  promptContext: IBuildPromptContext,
  cursors: RoundCursor[],
  summarizeCount: number
): ISummarizerView {
  // 只取前 summarizeCount 个 cursors 作为待压缩内容
  const roundsToSummarize = cursors.slice(0, summarizeCount);

  return {
    roundsToSummarize,
    originalContext: promptContext,  // 只读引用，不拷贝
    stats: {
      mode: 'half-window',
      totalRoundCount: cursors.length,
      summarizedRoundCount: summarizeCount,
      keptRoundCount: cursors.length - summarizeCount,
      splitStrategy: 'turn-boundary'
    }
  };
}
```

---

## 四、SummarizedConversationHistoryPropsBuilder 改进

### 4.1 新增方法签名

```typescript
export class SummarizedConversationHistoryPropsBuilder {
  constructor(
    @IPromptPathRepresentationService private readonly _promptPathRepresentationService: IPromptPathRepresentationService,
    @IWorkspaceService private readonly _workspaceService: IWorkspaceService,
  ) { }

  /**
   * 主入口：决定压缩策略并返回必要信息
   */
  getProps(props: SummarizedAgentHistoryProps): ISummarizedConversationHistoryInfo {
    // Step 1: 收集所有 rounds
    const cursors = this.collectRounds(props.promptContext);

    // Step 2: 检查是否有 summary 边界冲突
    if (this.hasSummaryBoundaryConflict(cursors, props.promptContext)) {
      return this.fallbackToExistingLogic(props, 'summary-boundary');
    }

    // Step 3: 计算半窗口切分
    const splitDecision = this.calculateHalfWindowSplit(cursors);

    // Step 4: 根据策略处理
    if (splitDecision.strategy === 'fallback-existing') {
      return this.fallbackToExistingLogic(props, splitDecision.fallbackReason);
    }

    // Step 5: 调整到 Turn 边界
    const adjustment = this.adjustToTurnBoundary(cursors, splitDecision.splitCursorIndex);

    // Step 6: 如果调整后无法压缩，fallback
    if (adjustment.adjustedSummarizeCount <= 0) {
      return this.fallbackToExistingLogic(props, 'not-enough-rounds');
    }

    // Step 7: 构建结果
    return this.buildHalfWindowResult(props, cursors, adjustment);
  }

  /**
   * 收集所有 rounds，返回游标数组
   */
  private collectRounds(promptContext: IBuildPromptContext): RoundCursor[] {
    // 实现如上文所述
  }

  /**
   * 检查是否存在 summary 边界冲突
   */
  private hasSummaryBoundaryConflict(
    cursors: RoundCursor[],
    promptContext: IBuildPromptContext
  ): boolean {
    // 如果 collectRounds 因为遇到 summary 而提前返回，
    // 检查是否影响了半窗口切分
    const totalPossibleRounds = this.countAllRoundsIgnoringSummary(promptContext);
    return cursors.length < totalPossibleRounds && cursors.length < MIN_ROUNDS_FOR_HALF_WINDOW;
  }

  /**
   * Fallback 到现有单轮压缩逻辑
   */
  private fallbackToExistingLogic(
    props: SummarizedAgentHistoryProps,
    reason?: CompressionFallbackReason
  ): ISummarizedConversationHistoryInfo {
    // 复用现有的 getProps 逻辑
    let toolCallRounds = props.promptContext.toolCallRounds;
    let isContinuation = props.promptContext.isContinuation;
    let summarizedToolCallRoundId = '';

    if (toolCallRounds && toolCallRounds.length > 1) {
      toolCallRounds = toolCallRounds.slice(0, -1);
      summarizedToolCallRoundId = toolCallRounds.at(-1)!.id;
    } else if (props.promptContext.history.length > 0) {
      isContinuation = true;
      toolCallRounds = [];
      summarizedToolCallRoundId = props.promptContext.history.at(-1)!.rounds.at(-1)!.id;
    } else {
      throw new Error('Nothing to summarize');
    }

    const promptContext = {
      ...props.promptContext,
      toolCallRounds,
      isContinuation,
    };

    return {
      props: {
        ...props,
        workingNotebook: this.getWorkingNotebook(props),
        promptContext
      },
      summarizedToolCallRoundId,
      compressionStats: {
        mode: 'fallback',
        totalRoundCount: this.collectRounds(props.promptContext).length,
        summarizedRoundCount: 1,
        keptRoundCount: (toolCallRounds?.length ?? 0) + this.countHistoryRounds(props.promptContext),
        splitStrategy: 'none',
        fallbackReason: reason
      }
    };
  }

  /**
   * 构建半窗口压缩结果
   */
  private buildHalfWindowResult(
    props: SummarizedAgentHistoryProps,
    cursors: RoundCursor[],
    adjustment: TurnBoundaryAdjustment
  ): ISummarizedConversationHistoryInfo {
    const { adjustedSplitIndex, adjustedSummarizeCount, adjustedKeepCount } = adjustment;

    // 确定 summary 锚点：压缩区的最后一个 round
    const lastSummarizedCursor = cursors[adjustedSplitIndex - 1];
    const summarizedToolCallRoundId = lastSummarizedCursor.round.id;

    // 构建修改后的 promptContext
    // 只需要修改 toolCallRounds，history 保持不变（summary 会标记在 round 上）
    const keptCursors = cursors.slice(adjustedSplitIndex);
    const keptActiveRounds = keptCursors
      .filter(c => c.source === 'active')
      .map(c => c.round);

    // 确定是否需要设置 isContinuation
    // 如果所有保留的 rounds 都来自 history，则需要设置
    const allKeptFromHistory = keptCursors.every(c => c.source === 'history');
    const hasKeptActiveRounds = keptActiveRounds.length > 0;

    const promptContext: IBuildPromptContext = {
      ...props.promptContext,
      toolCallRounds: hasKeptActiveRounds ? keptActiveRounds : [],
      isContinuation: allKeptFromHistory || props.promptContext.isContinuation,
    };

    return {
      props: {
        ...props,
        workingNotebook: this.getWorkingNotebook(props),
        promptContext
      },
      summarizedToolCallRoundId,
      compressionStats: {
        mode: 'half-window',
        totalRoundCount: cursors.length,
        summarizedRoundCount: adjustedSummarizeCount,
        keptRoundCount: adjustedKeepCount,
        splitStrategy: 'turn-boundary',
        fallbackReason: undefined
      }
    };
  }
}
```

---

## 五、SimpleSummarizedHistory 适配

### 5.1 为 Summarizer Prompt 提供 entries

`SimpleSummarizedHistory` 需要能够基于 `ISummarizerView` 渲染，而不是整个 `promptContext`。

```typescript
/**
 * 新增：从 SummarizerView 获取要渲染的 entries
 */
private getEntriesFromSummarizerView(view: ISummarizerView): ISummarizedHistoryEntry[] {
  const entries: ISummarizedHistoryEntry[] = [];

  for (const cursor of view.roundsToSummarize) {
    if (cursor.source === 'history' && cursor.turn) {
      // 来自历史 turn
      entries.push({
        kind: 'history-round',
        turn: cursor.turn,
        round: cursor.round,
        roundIndex: cursor.roundIndex,
        // 只在该 turn 的第一个 round 时包含 user message
        includeUserMessage: cursor.roundIndex === 0
      });
    } else if (cursor.source === 'active') {
      // 来自活跃 rounds
      entries.push({
        kind: 'active-round',
        round: cursor.round,
        roundIndex: cursor.roundIndex
      });
    }
  }

  return entries;
}
```

---

## 六、Summary 边界处理策略

### 6.1 场景分类

| 场景 | 描述 | 处理策略 |
|------|------|----------|
| 无历史 summary | 首次压缩 | 正常半窗口切分 |
| summary 在压缩区外 | summary 覆盖的内容比我们要压缩的更旧 | 正常处理，summary 继续生效 |
| summary 在压缩区内 | 半窗口切分点落在已有 summary 之后 | `collectRounds` 会在 summary 处停止，使用停止点之后的 rounds 进行切分 |
| summary 横跨切分点 | 切分点恰好落在 summary 边界 | 调整切分点到 summary 之后 |

### 6.2 具体处理流程

```typescript
function handleSummaryBoundary(
  promptContext: IBuildPromptContext,
  cursors: RoundCursor[],
  intendedSplitIndex: number
): { adjustedIndex: number; reason?: string } {
  // collectRounds 已经在遇到 summary 时停止了
  // cursors 只包含 summary 之后的 rounds

  // 如果 cursors 为空，说明所有内容都已被压缩
  if (cursors.length === 0) {
    return { adjustedIndex: 0, reason: 'all-summarized' };
  }

  // 如果 cursors 数量不足以进行半窗口切分
  if (cursors.length < MIN_ROUNDS_FOR_HALF_WINDOW) {
    return { adjustedIndex: 0, reason: 'insufficient-after-summary' };
  }

  // 正常切分
  return { adjustedIndex: intendedSplitIndex };
}
```

---

## 七、分阶段实施计划

### Phase 1: MVP（2-3 天）

**目标**：仅支持 active rounds 场景的半窗口压缩

**范围**：
- 实现 `collectRounds()` 基础版本（只处理 `toolCallRounds`）
- 实现 `calculateHalfWindowSplit()`
- 在 `SummarizedConversationHistoryPropsBuilder.getProps()` 中添加半窗口分支
- 添加基础 telemetry（`compressionMode`, `keptRoundCount`, `summarizedRoundCount`）

**限制**：
- 如果需要切分 history turns，fallback 到现有逻辑
- 不处理 Turn 边界调整

**测试**：
- 5+ active rounds 时触发半窗口压缩
- < 4 rounds 时 fallback
- 现有测试不回归

### Phase 2: History 支持（2-3 天）

**目标**：支持跨 history 和 active 的半窗口压缩

**范围**：
- 扩展 `collectRounds()` 支持 history turns
- 实现 `adjustToTurnBoundary()` Turn 边界调整
- 处理 `isContinuation` 标志
- 完善 summary 边界冲突检测

**测试**：
- 纯 history 场景（无 active rounds）
- 混合场景（history + active）
- summary 边界冲突场景

### Phase 3: 优化与监控（1-2 天）

**目标**：性能优化和完善监控

**范围**：
- 添加性能监控 telemetry（`compressionDuration`, `cursorCount`）
- 优化 `collectRounds()` 避免重复计算 `turn.rounds` getter
- 添加 `compressionStats` 到 metadata 用于调试
- 完善 fallback reason 分类

**测试**：
- 大对话场景（50+ rounds）性能测试
- Telemetry 完整性验证

---

## 八、Telemetry 扩展

### 8.1 新增字段

```typescript
interface SummarizationTelemetry {
  // 现有字段...

  // 新增：压缩模式
  compressionMode: 'half-window' | 'single-round' | 'fallback';

  // 新增：round 统计
  keptRoundCount: number;
  summarizedRoundCount: number;
  totalRoundCount: number;

  // 新增：切分信息
  splitStrategy: 'turn-boundary' | 'active-only' | 'none';
  splitPivotTurnIndex?: number;
  splitPivotRoundIndex?: number;

  // 新增：Fallback 原因
  compressionFallbackReason?: string;

  // 新增：边界调整
  boundaryAdjustmentType?: 'exact' | 'adjusted-to-turn-start' | 'adjusted-to-turn-end';
  boundaryAdjustmentDelta?: number;  // 调整了多少个 rounds
}
```

### 8.2 GDPR 注释更新

```typescript
/* __GDPR__
  "summarizedConversationHistory" : {
    // ... 现有字段 ...
    "compressionMode": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The compression strategy used: half-window, single-round, or fallback." },
    "keptRoundCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "Number of rounds kept verbatim." },
    "summarizedRoundCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "Number of rounds included in summary." },
    "totalRoundCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true, "comment": "Total number of rounds before compression." },
    "splitStrategy": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "How the split point was determined." },
    "compressionFallbackReason": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Why fallback was used if applicable." },
    "boundaryAdjustmentType": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "How the split was adjusted to turn boundary." }
  }
*/
```

---

## 九、测试计划

### 9.1 单元测试（summarization.spec.tsx）

```typescript
describe('SummarizedConversationHistoryPropsBuilder - Half Window', () => {
  describe('collectRounds', () => {
    it('should collect rounds in chronological order');
    it('should stop at existing summary');
    it('should handle empty history');
    it('should handle empty active rounds');
  });

  describe('calculateHalfWindowSplit', () => {
    it('should return half-window strategy when rounds >= 4');
    it('should fallback when rounds < 4');
    it('should ensure MIN_OVERLAP is respected');
  });

  describe('adjustToTurnBoundary', () => {
    it('should not adjust when split is at turn boundary');
    it('should adjust to turn start when split is mid-turn');
    it('should handle single-turn scenarios');
  });

  describe('getProps - half window mode', () => {
    it('should use half-window for 6 active rounds (keep 3, summarize 3)');
    it('should use half-window for 10 rounds across 3 turns');
    it('should fallback for 3 rounds');
    it('should handle summary boundary correctly');
  });
});
```

### 9.2 集成测试

```typescript
describe('Half Window Compression E2E', () => {
  it('should produce valid summary for half-window scenario');
  it('should correctly render kept rounds after summary');
  it('should persist summary metadata correctly');
  it('should handle continuation with half-window');
});
```

### 9.3 性能基准测试

```typescript
describe('Performance', () => {
  it('should handle 50 rounds in < 10ms', async () => {
    const start = performance.now();
    // ... create large promptContext
    builder.getProps(props);
    expect(performance.now() - start).toBeLessThan(10);
  });
});
```

---

## 十、风险与缓解

### 10.1 性能风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `turn.rounds` getter 重复计算 | 对话长时性能下降 | 在 `collectRounds` 中缓存结果 |
| 大型 round 数据 | 内存占用 | 只存储引用，不拷贝 |

### 10.2 正确性风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Turn 边界调整导致压缩比例偏离 | 用户体验不一致 | Telemetry 监控 `boundaryAdjustmentDelta` |
| Summary 边界冲突检测不完整 | 数据损坏 | 添加防御性检查，fallback 优先 |

### 10.3 兼容性风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 现有 summary metadata 格式 | 旧会话恢复失败 | 保持 `SummarizedConversationHistoryMetadata` 不变 |
| 现有渲染逻辑假设 | 显示异常 | 不修改渲染层，只修改 builder |

---

## 十一、附录

### A. 与原方案对比

| 方面 | 原方案 | 改进方案 |
|------|--------|----------|
| 深拷贝 | `JSON.parse(JSON.stringify())` | 结构共享 + 只读视图 |
| Turn 内切分 | 支持但复杂 | 只在 Turn 边界切分 |
| Fallback | 不明确 | 三级 fallback 体系 |
| 性能 | 未评估 | 设计时考虑，有监控 |
| 测试 | 基础 | 分层测试计划 |

### B. 决策记录

1. **为什么选择"只在 Turn 边界切分"**：Turn 的 `rounds` 是 getter 属性，无法直接修改；在内部切分需要创建新的 Turn 实例，复杂度高且容易引入 bug。Turn 边界切分虽然不够精确，但足够简单可靠。

2. **为什么不深拷贝**：`IBuildPromptContext` 包含 `ResourceMap`、`TextDocumentSnapshot` 等复杂类型，深拷贝会丢失原型链和方法。采用只读视图模式，summarizer 只需要读取数据，不需要修改。

3. **为什么保持 metadata 格式不变**：`SummarizedConversationHistoryMetadata` 会被持久化，修改格式会导致旧会话恢复问题。压缩统计信息通过 telemetry 发送，不影响持久化。

---

*文档版本：v2.0*
*最后更新：2024-01*
*作者：AI Assistant*
