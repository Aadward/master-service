"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";

import TaskNode, { type TaskNodeData } from "./TaskNode";

/**
 * DAGViewer · 性能与稳定性要点
 *
 *  - selection（哪个节点被选中）**不**会让 dagre 重新布局；
 *    只有"拓扑变化"才会重跑 layout（用 topologyKey 字符串作为 useMemo dep）
 *  - "状态变化"（status / retryCount）只重建 nodes 数据对象，position 沿用缓存
 *  - 通过 ReactFlowProvider + useReactFlow().fitView() 主动适配视口，
 *    避免从 Dashboard 跳进来时容器尺寸晚到导致的"空白 DAG"
 *  - TaskNode 用 React.memo 包裹
 */

const NODE_WIDTH = 200;
const NODE_HEIGHT = 70;

export interface DAGTaskInput {
  taskId: number;
  taskKey: string;
  module: string;
  status: string;
  retryCount?: number;
  lastErrorCode?: string | null;
}
export interface DAGEdgeInput {
  from: number;
  to: number;
}

const MemoTaskNode = memo(TaskNode);
const nodeTypes: NodeTypes = { task: MemoTaskNode };

interface Props {
  tasks: DAGTaskInput[];
  edges: DAGEdgeInput[];
  selectedTaskId?: number | null;
  onSelect?: (taskId: number) => void;
}

function DAGViewerInner({ tasks, edges, selectedTaskId, onSelect }: Props) {
  const rf = useReactFlow();

  // 内容签名 → 稳定的 data 对象引用
  // 当某个 taskId 的内容（status/retryCount/...）未变时，复用同一份 data 对象
  // 这样 React.memo(TaskNode) 才能真正阻止该节点的重渲染
  const dataCache = useRef(new Map<string, TaskNodeData>());

  // ── 拓扑 key：仅当 nodeId 集合或 edge 集合变化时才不同 ──────────────
  const topologyKey = useMemo(() => {
    const a = tasks.map((t) => t.taskId).sort((x, y) => x - y).join(",");
    const b = edges.map((e) => `${e.from}->${e.to}`).sort().join(",");
    return a + "|" + b;
  }, [tasks, edges]);

  // ── 仅在拓扑变化时跑 dagre ────────────────────────────────────────
  const positions = useMemo(() => {
    if (tasks.length === 0) return {} as Record<string, { x: number; y: number }>;
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 70 });
    tasks.forEach((t) => g.setNode(String(t.taskId), { width: NODE_WIDTH, height: NODE_HEIGHT }));
    edges.forEach((e) => g.setEdge(String(e.from), String(e.to)));
    dagre.layout(g);
    const out: Record<string, { x: number; y: number }> = {};
    for (const t of tasks) {
      const p = g.node(String(t.taskId));
      if (p) out[String(t.taskId)] = { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey]);

  // ── 状态 key：仅当某个 task 的 status/retryCount 变化时才重建节点数据 ──
  const statusKey = useMemo(
    () => tasks.map((t) => `${t.taskId}:${t.status}:${t.retryCount ?? 0}`).join(","),
    [tasks]
  );

  // ── baseNodes 不包含 selection；只受拓扑 + 状态影响 ─────────────────
  const baseNodes = useMemo<Node<TaskNodeData>[]>(() => {
    const cache = dataCache.current;
    // 清掉已经不存在的 taskId 的缓存
    const aliveIds = new Set(tasks.map((t) => String(t.taskId)));
    for (const k of cache.keys()) if (!aliveIds.has(k)) cache.delete(k);

    return tasks.map((t) => {
      const id = String(t.taskId);
      const prev = cache.get(id);
      const sameContent =
        prev &&
        prev.taskKey === t.taskKey &&
        prev.module === t.module &&
        prev.status === t.status &&
        prev.retryCount === t.retryCount &&
        prev.lastErrorCode === t.lastErrorCode;
      if (!sameContent) {
        cache.set(id, {
          taskKey: t.taskKey,
          module: t.module,
          status: t.status,
          retryCount: t.retryCount,
          lastErrorCode: t.lastErrorCode,
        });
      }
      return {
        id,
        type: "task" as const,
        position: positions[id] ?? { x: 0, y: 0 },
        data: cache.get(id)!,   // 引用稳定：内容未变就是同一对象
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey, positions]);

  // ── 仅 selection 变化的轻量映射 ─────────────────────────────────
  const nodes = useMemo<Node<TaskNodeData>[]>(
    () =>
      baseNodes.map((n) =>
        selectedTaskId === Number(n.id) ? { ...n, selected: true } : n
      ),
    [baseNodes, selectedTaskId]
  );

  // ── edges 在拓扑变化时重建 ──────────────────────────────────────
  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((e) => ({
        id: `${e.from}-${e.to}`,
        source: String(e.from),
        target: String(e.to),
        style: { stroke: "#94a3b8", strokeWidth: 1.5 },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topologyKey]
  );

  // ── 显式 fitView：拓扑变化（含首次有数据）时主动重新适配视口 ────────
  // 这是修"偶发空白"的关键：原本仅依赖 ReactFlow 的 fitView prop（只 mount 时跑一次）
  const fitTimer = useRef<number | null>(null);
  useEffect(() => {
    if (tasks.length === 0) return;
    if (fitTimer.current) cancelAnimationFrame(fitTimer.current);
    fitTimer.current = requestAnimationFrame(() => {
      // 再 setTimeout 一帧，等 layout 写入 DOM 后再 fitView
      setTimeout(() => rf.fitView({ padding: 0.2, duration: 250 }), 16);
    });
    return () => {
      if (fitTimer.current) cancelAnimationFrame(fitTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      // selectNodesOnDrag/elementsSelectable 保持默认行为
      onNodeClick={(_, n) => onSelect?.(Number(n.id))}
      onPaneClick={() => onSelect?.(-1)}
    >
      <Background gap={16} color="#e2e8f0" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => {
          const data = n.data as unknown as TaskNodeData;
          return colorOf(data.status);
        }}
        maskColor="rgba(241, 245, 249, 0.6)"
      />
    </ReactFlow>
  );
}

export default function DAGViewer(props: Props) {
  return (
    <ReactFlowProvider>
      <div className="h-full w-full">
        <DAGViewerInner {...props} />
      </div>
    </ReactFlowProvider>
  );
}

function colorOf(status: string) {
  return (
    {
      WAITING: "#9ca3af",
      READY: "#3b82f6",
      CLAIMED: "#f59e0b",
      IN_PROGRESS: "#f97316",
      DONE: "#10b981",
      FAILED: "#ef4444",
      SKIPPED: "#a78bfa",
      BLOCKED: "#7c3aed",
      CANCELLED: "#64748b",
    } as Record<string, string>
  )[status] ?? "#9ca3af";
}
