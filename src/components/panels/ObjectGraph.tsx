import { useMemo, type ReactNode } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node as FlowNode,
  type Edge as FlowEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { useCurrentSnapshot } from "@/store/useVisualizerStore";
import {
  buildGraph,
  type GraphNode,
  type GraphNodeKind,
} from "@/lib/buildGraph";

type SimNode = SimulationNodeDatum & { id: string };

const ACCENT: Record<GraphNodeKind, string> = {
  scope: "var(--color-accent)",
  object: "var(--color-ink-muted)",
  array: "var(--color-webapi)",
  function: "var(--color-stack)",
  promise: "var(--color-microtask)",
};

/** Run a quick force simulation; memoized so positions only move when the node/edge set changes. */
function useLayout(
  nodes: GraphNode[],
  edges: { id: string; source: string; target: string }[],
): Map<string, { x: number; y: number }> {
  const sig =
    nodes
      .map((n) => n.id)
      .sort()
      .join(",") +
    "|" +
    edges
      .map((e) => e.id)
      .sort()
      .join(",");
  return useMemo(() => {
    const sim: SimNode[] = nodes.map((n) => ({ id: n.id }));
    const links: SimulationLinkDatum<SimNode>[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));
    forceSimulation(sim)
      .force("charge", forceManyBody().strength(-500))
      .force(
        "link",
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
          .id((d) => d.id)
          .distance(130)
          .strength(0.5),
      )
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide(75))
      .stop()
      .tick(300);
    const pos = new Map<string, { x: number; y: number }>();
    for (const n of sim) pos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
}

function nodeLabel(n: GraphNode): ReactNode {
  return (
    <div className="text-left">
      <div className="font-semibold" style={{ color: ACCENT[n.kind] }}>
        {n.title}
      </div>
      {n.lines.slice(0, 6).map((l, i) => (
        <div key={i} className="text-[10px] text-ink-muted">
          {l}
        </div>
      ))}
    </div>
  );
}

/**
 * The object/reference graph: scopes + heap values wired by reference.
 * Force-directed via d3-force, rendered with React Flow (pan/zoom).
 */
export function ObjectGraph() {
  const snap = useCurrentSnapshot();
  const graph = useMemo(() => buildGraph(snap), [snap]);
  const pos = useLayout(graph.nodes, graph.edges);

  const flowNodes: FlowNode[] = graph.nodes.map((n) => ({
    id: n.id,
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    data: { label: nodeLabel(n) },
    draggable: false,
    style: {
      fontSize: 11,
      borderRadius: 8,
      border: `1px solid ${ACCENT[n.kind]}`,
      background: "var(--color-panel)",
      color: "var(--color-ink)",
      padding: 6,
      width: "auto",
      maxWidth: 200,
    },
  }));

  const flowEdges: FlowEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    animated: e.capture,
    style: { stroke: e.capture ? "var(--color-stack)" : "var(--color-edge)" },
    labelStyle: { fill: "var(--color-ink-muted)", fontSize: 10 },
    labelBgStyle: { fill: "var(--color-panel)" },
  }));

  return (
    <section className="h-80 overflow-hidden rounded-lg border border-edge bg-panel">
      <header className="flex h-8 items-center border-b border-edge px-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Object &amp; Reference Graph
      </header>
      {/* Height is a fixed percentage of the (definite-height) section so React
          Flow always measures a non-zero parent — avoids the error#004 warning
          that a flex-derived height triggers before layout flushes. */}
      <div className="h-[calc(100%-2rem)] w-full">
        {graph.nodes.length === 0 ? (
          <p className="p-3 text-xs italic text-ink-muted">
            No objects yet — create an object, array, function, or promise.
          </p>
        ) : (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
          >
            <Background color="var(--color-edge)" gap={18} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </section>
  );
}
