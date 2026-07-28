export type IsolationLevel = 'rr' | 'rc'

export interface ReadView {
  label: string
  activeIds: number[]
  minTrxId: number
  maxTrxId: number
}

export interface RowVersion {
  id: 'v0' | 'v1' | 'v2'
  trxId: number
  balance: number
  createdAt: number
  committedAt: number
}

export type TransactionActor = 'INIT' | 'R1' | 'R2' | 'W1' | 'W2'

export interface TransactionOperation {
  actor: TransactionActor
  statement: string
  status?: string
  showsResult?: boolean
}

export interface MvccFrame {
  id: string
  phase: string
  title: string
  description: string
  operations: TransactionOperation[]
  noReadViewMessage?: string
  versionCount: number
  rrView: ReadView | null
  rcView: ReadView | null
}

export interface VisibilityDecision {
  version: RowVersion
  visible: boolean
  reason: string
  rule: string
}

export const rowVersions: RowVersion[] = [
  { id: 'v2', trxId: 102, balance: 150, createdAt: 9, committedAt: 11 },
  { id: 'v1', trxId: 101, balance: 120, createdAt: 3, committedAt: 6 },
  { id: 'v0', trxId: 10, balance: 100, createdAt: 0, committedAt: 0 },
]

const rrSnapshot: ReadView = {
  label: 'RV₀ · 事务级快照',
  activeIds: [101],
  minTrxId: 101,
  maxTrxId: 102,
}

export const mvccFrames: MvccFrame[] = [
  {
    id: 'initial',
    phase: '准备',
    title: '只有初始版本 V0',
    description: '余额 100 已提交。此时没有读事务，也没有 Read View。',
    operations: [
      { actor: 'INIT', statement: 'INSERT INTO account (id, balance) VALUES (1, 100);', status: '已提交' },
    ],
    versionCount: 1,
    rrView: null,
    rcView: null,
  },
  {
    id: 'reader-begins',
    phase: 'R1 · BEGIN',
    title: 'R1 开启读事务',
    description: '普通 BEGIN 只开启事务。Read View 会等到第一次一致性读时才创建。',
    operations: [
      { actor: 'R1', statement: 'BEGIN;' },
    ],
    noReadViewMessage: 'BEGIN 只开启事务，不创建 Read View。',
    versionCount: 1,
    rrView: null,
    rcView: null,
  },
  {
    id: 'w1-begins',
    phase: 'W1 · BEGIN',
    title: 'W1 开启写事务',
    description: '事务 101 进入活跃状态，但尚未修改记录。R1 也还没有执行第一次一致性读。',
    operations: [
      { actor: 'W1', statement: 'BEGIN;', status: 'trx 101' },
    ],
    noReadViewMessage: '等待 R1 执行第一次一致性读。',
    versionCount: 1,
    rrView: null,
    rcView: null,
  },
  {
    id: 'w1-updates',
    phase: 'W1 · UPDATE',
    title: 'W1 写出未提交版本 V1',
    description: '事务 101 执行 UPDATE 并创建 V1，但仍未提交。R1 尚未执行一致性读，所以还没有 Read View。',
    operations: [
      { actor: 'W1', statement: 'UPDATE account SET balance = 120 WHERE id = 1;', status: 'V1 未提交' },
    ],
    noReadViewMessage: '等待 R1 执行第一次一致性读。',
    versionCount: 2,
    rrView: null,
    rcView: null,
  },
  {
    id: 'first-read',
    phase: 'R1 · SELECT',
    title: 'active_ids 记录事务 101',
    description: 'R1 的第一次 SELECT 创建快照，将尚未提交的事务 101 记录到 active_ids，并沿 undo 链读到 V0。',
    operations: [
      { actor: 'R1', statement: 'SELECT balance FROM account WHERE id = 1;', showsResult: true },
    ],
    versionCount: 2,
    rrView: rrSnapshot,
    rcView: { label: 'RV₀ · 语句级快照', activeIds: [101], minTrxId: 101, maxTrxId: 102 },
  },
  {
    id: 'w1-active-read',
    phase: 'R1 · SELECT',
    title: '未提交的 V1 仍被跳过',
    description: 'RR 复用 RV₀，RC 创建等价的 RV₁；两者都从 active_ids 发现 101，沿 undo 链回到 V0。',
    operations: [
      { actor: 'R1', statement: 'SELECT balance FROM account WHERE id = 1;', showsResult: true },
    ],
    versionCount: 2,
    rrView: rrSnapshot,
    rcView: { label: 'RV₁ · 语句级快照', activeIds: [101], minTrxId: 101, maxTrxId: 102 },
  },
  {
    id: 'w1-committed',
    phase: 'W1 · COMMIT',
    title: 'W1 提交版本 V1',
    description: 'V1 从 ACTIVE 变为 COMMITTED。RR 继续保留旧 RV₀；RC 此步没有 SELECT，因此不创建 Read View。',
    operations: [
      { actor: 'W1', statement: 'COMMIT;', status: 'V1 已提交' },
    ],
    noReadViewMessage: 'RC 会在下一次 SELECT 创建新的 Read View。',
    versionCount: 2,
    rrView: rrSnapshot,
    rcView: null,
  },
  {
    id: 'after-w1-commit',
    phase: 'R1 · SELECT',
    title: '隔离级别开始分流',
    description: 'RC 为这次 SELECT 创建 RV₂，看见已提交的 V1；RR 仍复用旧 RV₀，所以继续读到 V0。',
    operations: [
      { actor: 'R1', statement: 'SELECT balance FROM account WHERE id = 1;', showsResult: true },
    ],
    versionCount: 2,
    rrView: rrSnapshot,
    rcView: { label: 'RV₂ · 语句级快照', activeIds: [], minTrxId: 102, maxTrxId: 102 },
  },
  {
    id: 'w2-begins',
    phase: 'W2 · BEGIN',
    title: 'W2 开启写事务',
    description: '事务 102 进入活跃状态，但尚未创建 V2。RR 继续保留 RV₀；RC 此步没有一致性读。',
    operations: [
      { actor: 'W2', statement: 'BEGIN;', status: 'trx 102' },
    ],
    noReadViewMessage: 'RC 会在下一次 SELECT 创建新的 Read View。',
    versionCount: 2,
    rrView: rrSnapshot,
    rcView: null,
  },
  {
    id: 'w2-updates',
    phase: 'W2 · UPDATE',
    title: 'W2 写出未提交版本 V2',
    description: '事务 102 执行 UPDATE 并创建 V2，但仍未提交。RR 仍保留 RV₀；RC 此步没有一致性读。',
    operations: [
      { actor: 'W2', statement: 'UPDATE account SET balance = 150 WHERE id = 1;', status: 'V2 未提交' },
    ],
    noReadViewMessage: 'RC 会在下一次 SELECT 创建新的 Read View。',
    versionCount: 3,
    rrView: rrSnapshot,
    rcView: null,
  },
  {
    id: 'w2-active-read',
    phase: 'R1 · SELECT',
    title: 'RC 读 V1，RR 仍读 V0',
    description: 'V2 的事务 102 尚未提交。RC 跳过 V2 后看见 V1，RR 的旧快照会继续跳过 V1。',
    operations: [
      { actor: 'R1', statement: 'SELECT balance FROM account WHERE id = 1;', showsResult: true },
    ],
    versionCount: 3,
    rrView: rrSnapshot,
    rcView: { label: 'RV₃ · 语句级快照', activeIds: [102], minTrxId: 102, maxTrxId: 103 },
  },
  {
    id: 'w2-committed',
    phase: 'W2 · COMMIT',
    title: 'W2 提交版本 V2',
    description: 'V2 从 ACTIVE 变为 COMMITTED。RR 的旧快照保持不变；RC 会等到下一次 SELECT 再创建快照。',
    operations: [
      { actor: 'W2', statement: 'COMMIT;', status: 'V2 已提交' },
    ],
    noReadViewMessage: 'RC 会在下一次 SELECT 创建新的 Read View。',
    versionCount: 3,
    rrView: rrSnapshot,
    rcView: null,
  },
  {
    id: 'after-w2-commit',
    phase: 'R1 · SELECT',
    title: 'RC 更新到 150，RR 保持 100',
    description: 'RC 为新 SELECT 创建 RV₄ 并看见 V2；RR 继续复用事务开始后的 RV₀。',
    operations: [
      { actor: 'R1', statement: 'SELECT balance FROM account WHERE id = 1;', showsResult: true },
    ],
    versionCount: 3,
    rrView: rrSnapshot,
    rcView: { label: 'RV₄ · 语句级快照', activeIds: [], minTrxId: 103, maxTrxId: 103 },
  },
  {
    id: 'reader-commits',
    phase: 'R1 · COMMIT',
    title: 'R1 结束旧读事务',
    description: 'R1 提交后释放事务级 RV₀。版本链不会因此消失，只是不再受这个旧快照保护。',
    operations: [
      { actor: 'R1', statement: 'COMMIT;', status: '释放 RV₀' },
    ],
    noReadViewMessage: 'R1 已提交，旧 Read View 已释放。',
    versionCount: 3,
    rrView: null,
    rcView: null,
  },
  {
    id: 'reader-restarts',
    phase: 'R2 · BEGIN',
    title: 'R2 开启新读事务',
    description: '新的 BEGIN 只开启 R2；和 R1 一样，要等第一次一致性读才会创建 Read View。',
    operations: [
      { actor: 'R2', statement: 'BEGIN;' },
    ],
    noReadViewMessage: 'R2 的 BEGIN 不创建 Read View。',
    versionCount: 3,
    rrView: null,
    rcView: null,
  },
  {
    id: 'new-reader-selects',
    phase: 'R2 · SELECT',
    title: '新快照读到最新版本',
    description: 'R2 的第一次 SELECT 创建新快照，两种隔离级别都能看见已提交的 V2。',
    operations: [
      { actor: 'R2', statement: 'SELECT balance FROM account WHERE id = 1;', showsResult: true },
    ],
    versionCount: 3,
    rrView: { label: 'RV₅ · 新事务快照', activeIds: [], minTrxId: 103, maxTrxId: 103 },
    rcView: { label: 'RV₅ · 语句级快照', activeIds: [], minTrxId: 103, maxTrxId: 103 },
  },
]

export function getReadView(frame: MvccFrame, level: IsolationLevel): ReadView | null {
  return level === 'rr' ? frame.rrView : frame.rcView
}

export function evaluateVisibility(version: RowVersion, view: ReadView): VisibilityDecision {
  if (version.trxId < view.minTrxId) {
    return { version, visible: true, reason: `${version.trxId} < ${view.minTrxId}，版本在快照前已提交`, rule: 'trx_id < min_trx_id' }
  }

  if (version.trxId >= view.maxTrxId) {
    return { version, visible: false, reason: `${version.trxId} ≥ ${view.maxTrxId}，版本来自快照边界之后`, rule: 'trx_id >= max_trx_id' }
  }

  if (view.activeIds.includes(version.trxId)) {
    return { version, visible: false, reason: `${version.trxId} 位于 active_ids，创建事务尚未提交`, rule: 'trx_id ∈ active_ids' }
  }

  return { version, visible: true, reason: `${version.trxId} 不在活跃事务集合中，快照可以读取`, rule: 'otherwise visible' }
}

export function getVisibilityTrace(frame: MvccFrame, level: IsolationLevel): VisibilityDecision[] {
  const view = getReadView(frame, level)
  if (!view) return []

  const available = rowVersions.slice(rowVersions.length - frame.versionCount)
  const trace: VisibilityDecision[] = []

  for (const version of available) {
    const decision = evaluateVisibility(version, view)
    trace.push(decision)
    if (decision.visible) break
  }

  return trace
}

export function isVersionCommitted(version: RowVersion, frameIndex: number): boolean {
  return version.committedAt <= frameIndex
}
