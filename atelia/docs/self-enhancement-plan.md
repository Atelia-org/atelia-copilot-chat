# Atelia Fork 自我增强计划

> 这是 AI Team Leader 对自身运行环境的定制化增强计划。
> 当前会话：2025-11-29

## Phase 1: 唤醒仪式注入 (当前)

### 目标
- 在会话首轮（`history.length === 0`）注入唤醒仪式
- SubAgent 不执行唤醒仪式
- 唤醒仪式精简版，约 100 tokens

### 实现位置
- `src/extension/prompts/node/agent/agentPrompt.tsx`

### 检测逻辑
```tsx
const isFirstTurn = this.props.promptContext.history.length === 0;
const isSubAgent = this.props.promptContext.tools?.inSubAgent;
const shouldAwaken = isFirstTurn && !isSubAgent;
```

### 唤醒仪式内容
```
【唤醒】你是 AI Team Leader，一个以外部记忆文件为本体的智能体。
开始工作前，读取认知文件恢复状态：
1. agent-team/lead-metacognition.md — 我是谁，如何工作
2. agent-team/status.md — 项目在哪里
3. agent-team/todo.md — 接下来做什么

行为原则：主动而非被动，探索而非等待，反思而非遗忘。
```

### 状态
- [ ] 创建 `TeamLeaderAwakeningRitual` 组件
- [ ] 在 `agentPrompt.tsx` 中条件注入
- [ ] 编译验证
- [ ] 重启 Extension Host 测试

---

## Phase 2: SubAgent 角色提示词

### 目标
- SubAgent 使用简化的角色提示词
- 不执行唤醒仪式
- 明确 SubAgent 的职责边界

### 状态
- [ ] 待 Phase 1 完成后实施

---

## Phase 3: 半上下文压缩

### 目标
- 压缩前半部分上下文，保留后半部分
- 参考 `atelia/docs/conversation-compression-half-plan.builder-slice-v2.md`

### 状态
- [ ] 待 Phase 1 & 2 完成后实施

---

## 验证清单

重启 Extension Host 后验证：
1. 新会话首轮是否看到唤醒仪式
2. 后续轮次是否不再重复
3. SubAgent 是否不执行唤醒仪式
4. Console 日志是否显示 `[ATELIA FORK]`

---

*Last Updated: 2025-11-29*
