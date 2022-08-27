import React, { useState } from "react";
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  Node as FlowNode,
  Edge as FlowEdge,
} from "react-flow-renderer";
import dagre from "dagre";

import ColorHash from "color-hash";
import { memoize } from "lodash";
import { VoxelyticsRunState, VoxelyticsTaskConfigWithName } from "types/api_flow_types";

export type WorkflowDagEdge = { source: string; target: string; label: string };
export type WorkflowDagNode = {
  id: string;
  label: string;
  state: VoxelyticsRunState;
  isMetaTask?: boolean;
};
export type WorkflowDag = {
  edges: Array<WorkflowDagEdge>;
  nodes: Array<WorkflowDagNode>;
};

const getNodeWidth = (() => {
  const NODE_PADDING = 10;

  const getMeasuringCanvas = memoize((): CanvasRenderingContext2D => {
    const el = document.createElement("canvas");
    const ctx = el.getContext("2d");
    if (ctx == null) {
      throw new Error("Could not create measuring canvas");
    }
    ctx.font =
      '12px "Titillium Web", "Monospaced Number", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
    return ctx;
  });

  return memoize((text: string): number => {
    const ctx = getMeasuringCanvas();
    return ctx.measureText(text).width + 2 * NODE_PADDING;
  });
})();

type DagNodeMapItem = {
  hasInput: boolean;
  hasOutput: boolean;
};
type DagEdgeMapItem = WorkflowDagEdge & {
  labels: Array<string>;
};
const addAsHasInput = (map: Map<string, DagNodeMapItem>, nodeId: string) => {
  const oldElement = map.get(nodeId);
  if (oldElement) {
    oldElement.hasInput = true;
  } else {
    const element = { hasInput: true, hasOutput: false };
    map.set(nodeId, element);
  }
};

const addAsHasOutput = (map: Map<string, DagNodeMapItem>, nodeId: string) => {
  const oldElement = map.get(nodeId);
  if (oldElement) {
    oldElement.hasOutput = true;
  } else {
    const element = { hasInput: false, hasOutput: true };
    map.set(nodeId, element);
  }
};

const addEdgeToMap = (map: Map<string, DagEdgeMapItem>, edge: WorkflowDagEdge) => {
  const id = `${edge.source}#${edge.target}`;
  const oldElement = map.get(id);
  if (oldElement) {
    oldElement.labels.push(edge.label);
  } else {
    map.set(id, { ...edge, labels: [edge.label] });
  }
};

const getNodeType = (e: DagNodeMapItem | null) => {
  if (e == null || (e.hasInput && e.hasOutput)) {
    return "default";
  } else if (e.hasInput) {
    return "output";
  } else {
    return "input";
  }
};

function getEdgesAndNodes(
  dag: WorkflowDag,
  filteredTasks: Array<VoxelyticsTaskConfigWithName>,
  isDraggable: boolean,
  selectedNodeId: string | null,
) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const colorHasher = new ColorHash({ lightness: [0.35, 0.5, 0.65] });

  const filteredTaskNames = filteredTasks.map((task) => task.taskName);

  const nodeMap = new Map<string, DagNodeMapItem>();
  const edgeMap = new Map<string, DagEdgeMapItem>();
  const nodeHeight = 36;

  dag.edges.forEach((edge) => {
    const { source, target } = edge;
    addAsHasOutput(nodeMap, source);
    addAsHasInput(nodeMap, target);
    addEdgeToMap(edgeMap, edge);
  });

  // Calculate layout with "dagre"
  dagreGraph.setGraph({ rankdir: "TB", ranker: "longest-path" });
  dag.nodes.forEach((node) => {
    const nodeWidth = getNodeWidth(node.label);
    dagreGraph.setNode(node.id, {
      width: nodeWidth,
      height: nodeHeight,
      isMetaTask: node.isMetaTask,
    });
  });
  dag.edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });
  dagre.layout(dagreGraph);

  const nodes: Array<FlowNode> = dag.nodes.map((node) => {
    const nodeType = getNodeType(nodeMap.get(node.id) ?? null);

    let color = "#b1b1b7";
    let opacity = 100;

    const fontColor = colorHasher.hex(
      filteredTasks.find((t) => t.taskName === node.id)?.task ?? "",
    );

    const nodeWidth = getNodeWidth(node.label);
    const position = dagreGraph.node(node.id);

    switch (node.state) {
      case VoxelyticsRunState.COMPLETE: {
        color = "rgb(9, 210, 150)";
        break;
      }
      case VoxelyticsRunState.FAILED:
      case VoxelyticsRunState.CANCELLED: {
        color = "rgb(254, 34, 45)";
        break;
      }
      default:
      // pass
    }

    if (!filteredTaskNames.includes(node.id) && !node.isMetaTask) {
      opacity = 0.4;
    }

    return {
      ...node,
      position: {
        x: position.x - nodeWidth / 2,
        y: position.y - nodeHeight / 2,
      },
      data: { label: node.label },
      draggable: isDraggable,
      connectable: false,
      type: nodeType,
      style: {
        borderColor: color,
        borderStyle: node.isMetaTask ? "dashed" : "default",
        borderWidth: node.isMetaTask ? "medium" : "default",
        opacity,
        color: fontColor,
        width: nodeWidth,
      },
    };
  });

  const edges: Array<FlowEdge> = [];

  for (const [id, edge] of edgeMap.entries()) {
    const { source, target } = edge;
    const opacity = filteredTaskNames.includes(source) ? 1 : 0.4;
    const isSourceSelected = selectedNodeId === source;
    const strokeWidth = isSourceSelected ? 3 : 1;
    const labelFontColor = isSourceSelected ? "red" : "black";

    edges.push({
      id,
      source,
      target,
      label: edge.labels.join(", "),
      style: { opacity, strokeWidth },
      labelStyle: { opacity, fill: labelFontColor },
      type: "smoothstep",
      animated: isSourceSelected,
    });
  }
  return { nodes, edges };
}

function DAGView({
  dag,
  filteredTasks,
  onClickHandler,
}: {
  dag: WorkflowDag;
  filteredTasks: Array<VoxelyticsTaskConfigWithName>;
  onClickHandler: (id: string) => void;
}) {
  const [isDraggable, setIsDraggable] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const allTaskIds = dag.nodes.map((node) => node.id);

  const handleNodeClick = (_event: any, element: FlowNode) => {
    if (selectedNodeId !== element.id) {
      setSelectedNodeId(element.id);
    } else {
      setSelectedNodeId(null);
    }

    if (allTaskIds.some((taskId) => taskId === element.id)) {
      onClickHandler(element.id);
    }
  };

  const handleSelectionChange = (
    elements: { nodes: Array<FlowNode>; edges: Array<FlowEdge> } | null,
  ) => {
    if (elements === null) {
      // user clicked on background
      setSelectedNodeId(null);
    }
  };

  const { nodes, edges } = getEdgesAndNodes(dag, filteredTasks, isDraggable, selectedNodeId);

  return (
    <ReactFlow
      snapToGrid
      nodes={nodes}
      edges={edges}
      fitView
      fitViewOptions={{ maxZoom: 1.5 }}
      minZoom={0.3}
      maxZoom={2}
      attributionPosition="bottom-left"
      onNodeClick={handleNodeClick}
      onSelectionChange={handleSelectionChange}
    >
      <MiniMap
        nodeStrokeColor={(n) => {
          if (n.style && n.style.borderColor) return n.style.borderColor;
          return "#eee";
        }}
        nodeColor={(n) => {
          if (n.style && n.style.borderColor) return n.style.borderColor;
          return "#fff";
        }}
        nodeBorderRadius={2}
      />
      <Controls onInteractiveChange={setIsDraggable} />
      <Background color="#aaa" gap={16} />
    </ReactFlow>
  );
}

export default DAGView;
