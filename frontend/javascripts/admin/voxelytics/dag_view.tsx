import { useRef, useState } from "react";
import ReactFlow, {
  MiniMap,
  Background,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type ReactFlowInstance,
} from "react-flow-renderer";
import dagre from "dagre";

import ColorHash from "color-hash";
import { memoize } from "lodash";
import {
  VoxelyticsRunState,
  type VoxelyticsTaskConfigWithName,
  type VoxelyticsWorkflowDag,
  type VoxelyticsWorkflowDagEdge,
} from "types/api_flow_types";
import { useSelector } from "react-redux";
import type { OxalisState, Theme } from "oxalis/store";
import { Button } from "antd";
import { ExpandOutlined, MinusOutlined, PlusOutlined } from "@ant-design/icons";

export const colorHasher = new ColorHash({ lightness: [0.35, 0.5, 0.65] });

const getNodeWidth = (() => {
  const NODE_PADDING = 10;

  const getMeasuringCanvas = memoize((): CanvasRenderingContext2D => {
    const el = document.createElement("canvas");
    const ctx = el.getContext("2d");
    if (ctx == null) {
      throw new Error("Could not create measuring canvas");
    }
    ctx.font =
      '12px "Nunito", "Monospaced Number", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
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
type DagEdgeMapItem = VoxelyticsWorkflowDagEdge & {
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

const addEdgeToMap = (map: Map<string, DagEdgeMapItem>, edge: VoxelyticsWorkflowDagEdge) => {
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
  dag: VoxelyticsWorkflowDag,
  filteredTasks: Array<VoxelyticsTaskConfigWithName>,
  selectedNodeId: string | null,
  theme: Theme,
) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

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
      connectable: false,
      type: nodeType,
      style: {
        borderColor: color,
        borderStyle: node.isMetaTask ? "dashed" : "default",
        borderWidth: node.isMetaTask ? 2 : 1,
        opacity,
        color: fontColor,
        width: nodeWidth + (node.isMetaTask ? 4 : 2),
        backgroundColor: theme === "light" ? "white" : "black",
      },
    };
  });

  const edges: Array<FlowEdge> = [];

  for (const [id, edge] of edgeMap.entries()) {
    const { source, target } = edge;
    const opacity = filteredTaskNames.includes(source) ? 1 : 0.4;
    const isSourceSelected = selectedNodeId === source;
    const strokeWidth = isSourceSelected ? 3 : 1;
    const labelFontColor = isSourceSelected ? "red" : null;

    edges.push({
      id,
      source,
      target,
      label: edge.labels.join(", "),
      style: { opacity, strokeWidth },
      labelStyle: {
        opacity,
        fill: labelFontColor ?? theme === "light" ? "black" : "white",
      },
      labelBgStyle: {
        fill: theme === "light" ? "white" : "black",
        stroke: "#b1b1b7",
      },
      labelShowBg: true,
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
  dag: VoxelyticsWorkflowDag;
  filteredTasks: Array<VoxelyticsTaskConfigWithName>;
  onClickHandler: (id: string) => void;
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const allTaskIds = dag.nodes.map((node) => node.id);
  const theme = useSelector((state: OxalisState) => state.uiInformation.theme);
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);

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

  const { nodes, edges } = getEdgesAndNodes(dag, filteredTasks, selectedNodeId, theme);

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
      onInit={(reactFlowInstance) => {
        reactFlowRef.current = reactFlowInstance;
      }}
    >
      <MiniMap
        nodeStrokeColor={(n) => {
          if (n.style?.borderColor) return n.style.borderColor;
          return "#eee";
        }}
        nodeColor={(n) => {
          if (n.style?.borderColor) return n.style.borderColor;
          return "#fff";
        }}
        nodeBorderRadius={2}
      />
      <Background color="#aaa" gap={16} />
      <div className="controls">
        <Button
          icon={<PlusOutlined />}
          size="small"
          onClick={() => {
            reactFlowRef.current?.zoomIn();
          }}
        />
        <Button
          icon={<MinusOutlined />}
          size="small"
          onClick={() => {
            reactFlowRef.current?.zoomOut();
          }}
        />
        <Button
          icon={<ExpandOutlined />}
          size="small"
          onClick={() => {
            reactFlowRef.current?.fitView();
          }}
        />
      </div>
    </ReactFlow>
  );
}

export default DAGView;
