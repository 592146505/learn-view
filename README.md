# 原理实验室（Learn View）

通过可暂停、可单步执行的交互动画理解后端技术原理。

当前包含：

- MySQL InnoDB MVCC：对比 Repeatable Read 与 Read Committed 的 Read View 和版本链可见性
- Redis Sentinel：展示 SDOWN、ODOWN、协调者授权、副本选择、晋升与拓扑收敛
- Redis Cluster：展示哈希槽路由、PFAIL/FAIL 本地视图、副本选举与槽位所有权收敛

## 本地运行

```bash
npm install
npm run dev
```

生产构建与测试：

```bash
npm test
npm run build
```

## 项目结构

```text
src/
  components/       # 实验界面和通用播放器
  composables/      # 步骤播放状态
  simulations/      # 领域模型、帧数据和测试
```

新增实验时，先在 `src/simulations/` 定义确定性的状态帧，再由组件将状态映射为 SVG 画面。动画只负责帧之间的过渡，不承担领域规则计算。
