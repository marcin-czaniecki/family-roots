import { addEdge, Background, type Connection, type Edge, type Node, ReactFlow } from "@xyflow/react";
import { FitToTop } from "@/components/FitToTop";
import type { Relation } from "@/entities/relation/types";
import { buildGenealogyGraph, edgeTypes, nodeTypes } from "@/features/genealogyLayout";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useState } from "react";
import { useLoaderData } from "react-router";

export function Home() {
  const relations = useLoaderData<Relation[]>();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    (async () => {
      const graph = await buildGenealogyGraph(relations);
      setNodes(graph.nodes);
      setEdges(graph.edges);
    })();
  }, [relations]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((edgesSnapshot) => addEdge({ ...params, type: "descent" }, edgesSnapshot)),
    [],
  );

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#f3efe8" }}>
      <ReactFlow
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodes={nodes}
        edges={edges}
        onConnect={onConnect}
        colorMode="light"
        defaultEdgeOptions={{ zIndex: 2, style: { stroke: "#8a735a", strokeWidth: 1.6 } }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={1.6}
        style={{ ["--xy-edge-stroke" as string]: "#8a735a" }}
      >
        <FitToTop ready={nodes.length > 0} />
        <Background color="#d5cbb8" gap={28} size={1} />
        <style>{`
          .react-flow__viewport .react-flow__edges {
            z-index: 5 !important;
          }
          .react-flow__viewport .react-flow__nodes {
            z-index: 3 !important;
          }
          .react-flow__edge-path {
            stroke-linecap: square;
            pointer-events: none;
          }
        `}</style>
      </ReactFlow>
    </div>
  );
}
