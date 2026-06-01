"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import TaskNode from "@/components/TaskNode";
import JSONView from "@/components/JSONView";

interface TemplateDef {
  customer_type: string;
  version: number;
  description?: string;
  modules: Record<
    string,
    {
      tasks: Array<{
        task_key: string;
        page_ref?: string;
        depends_on?: string[];
        suggestions?: Record<string, unknown>;
        required?: boolean;
      }>;
    }
  >;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 70;

function layout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 70 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } };
  });
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateDef[]>([]);
  const [active, setActive] = useState<TemplateDef | null>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => {
        const defs = (j.items ?? []).map(
          (it: { definition: TemplateDef }) => it.definition
        );
        setTemplates(defs);
        if (defs[0]) setActive(defs[0]);
      });
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!active) return { nodes: [], edges: [] };
    const allTasks: Array<{ key: string; module: string; deps: string[]; sugg?: Record<string, unknown> }> = [];
    for (const [m, mod] of Object.entries(active.modules)) {
      for (const t of mod.tasks) {
        allTasks.push({ key: t.task_key, module: m, deps: t.depends_on ?? [], sugg: t.suggestions });
      }
    }
    const rawNodes: Node[] = allTasks.map((t) => ({
      id: t.key,
      type: "task",
      data: {
        taskKey: t.key,
        module: t.module,
        status: "WAITING",
      },
      position: { x: 0, y: 0 },
    }));
    const rawEdges: Edge[] = [];
    allTasks.forEach((t) => {
      t.deps.forEach((d, i) => {
        rawEdges.push({
          id: `${d}->${t.key}-${i}`,
          source: d,
          target: t.key,
          style: { stroke: "#94a3b8", strokeWidth: 1.5 },
        });
      });
    });
    return { nodes: layout(rawNodes, rawEdges), edges: rawEdges };
  }, [active]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Templates</h1>
        <p className="mt-1 text-sm text-slate-500">
          只读：当前 active 的模板及其 DAG 结构。模板版本化、可灰度，但 POC 仅展示当前版本。
        </p>
      </header>

      <section className="flex flex-wrap gap-2">
        {templates.map((t) => (
          <button
            key={t.customer_type}
            onClick={() => setActive(t)}
            className={`btn ${active?.customer_type === t.customer_type ? "btn-primary" : ""}`}
          >
            {t.customer_type} <span className="ml-1 text-xs opacity-70">v{t.version}</span>
          </button>
        ))}
      </section>

      {active && (
        <>
          <section className="card">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  customer_type
                </div>
                <div className="font-mono text-lg">{active.customer_type}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  version
                </div>
                <div className="font-mono text-lg">v{active.version}</div>
              </div>
            </div>
            {active.description && (
              <p className="mt-2 text-sm text-slate-600">{active.description}</p>
            )}
          </section>

          <section className="card overflow-hidden p-0">
            <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              DAG Structure
            </div>
            <div className="h-[500px]">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={{ task: TaskNode }}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                proOptions={{ hideAttribution: true }}
                nodesDraggable={false}
                nodesConnectable={false}
              >
                <Background gap={16} color="#e2e8f0" />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </section>

          <section className="card">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Raw Definition (JSON)
            </div>
            <JSONView value={active} />
          </section>
        </>
      )}
    </div>
  );
}
