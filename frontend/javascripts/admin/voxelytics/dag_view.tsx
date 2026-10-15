import { ExpandOutlined, MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { theme as antdTheme, Button } from "antd";
import ColorHash from "color-hash";
import dagre from "dagre";
import { useWkSelector } from "libs/react_hooks";
import memoize from "lodash-es/memoize";
import { useRef, useState } from "react";
import ReactFlow, {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type Edge as FlowEdge,
  type Node as FlowNode,
  MiniMap,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  VoxelyticsRunState,
  type VoxelyticsTaskConfigWithName,
  type VoxelyticsWorkflowDag,
  type VoxelyticsWorkflowDagEdge,
  type VoxelyticsWorkflowDagNode,
} from "types/api_types";
import type { Theme } from "viewer/store";

export const colorHasher = new ColorHash({ lightness: [0.35, 0.5, 0.65] });

const FONT_FAMILY =
  '"Nunito", "Monospaced Number", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
const NODE_FONT_SIZE = 12;
const NODE_PADDING = 10;
const NODE_HEIGHT = 36;
// Matches React Flow's default edge label font size.
const EDGE_LABEL_FONT_SIZE = 10;
const EDGE_LABEL_PADDING_X = 4;
const EDGE_LABEL_HEIGHT = 18;

const getMeasuringCanvas = memoize((): CanvasRenderingContext2D => {
  const el = document.createElement("canvas");
  const ctx = el.getContext("2d");
  if (ctx == null) {
    throw new Error("Could not create measuring canvas");
  }
  return ctx;
});

const measureTextWidth = memoize(
  (text: string, fontSize: number): number => {
    const ctx = getMeasuringCanvas();
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    return Math.ceil(ctx.measureText(text).width);
  },
  (text, fontSize) => `${fontSize}#${text}`,
);

const getNodeWidth = (text: string): number =>
  measureTextWidth(text, NODE_FONT_SIZE) + 2 * NODE_PADDING;

const getEdgeLabelWidth = (text: string): number =>
  measureTextWidth(text, EDGE_LABEL_FONT_SIZE) + 2 * EDGE_LABEL_PADDING_X + 2;

type Point = { x: number; y: number };

type DagEdgeData = {
  points: Array<Point>;
  label: string;
  labelPosition: Point | null;
  labelColor: string;
  labelBackgroundColor: string;
  labelBorderColor: string;
  opacity: number;
};

const EDGE_CORNER_RADIUS = 5;

// Turns the route into vertical and horizontal segments: between two points that are
// horizontally offset, the edge goes down to the middle, across, and down again.
// dagre leaves the space between ranks free of nodes, so the horizontal segments never
// cross a node or a label.
function getOrthogonalPoints(points: Array<Point>): Array<Point> {
  const orthogonalPoints = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const next = points[i];
    if (Math.abs(prev.x - next.x) > 0.5) {
      const midY = (prev.y + next.y) / 2;
      orthogonalPoints.push({ x: prev.x, y: midY }, { x: next.x, y: midY });
    }
    orthogonalPoints.push(next);
  }
  return orthogonalPoints;
}

// Draws straight segments through the given points and rounds off each corner.
function getRoundedCornerPath(allPoints: Array<Point>, radius: number): string {
  // Consecutive duplicate points would form zero-length segments without a direction.
  const points = allPoints.filter(
    (p, i) => i === 0 || p.x !== allPoints[i - 1].x || p.y !== allPoints[i - 1].y,
  );
  let path = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, corner, next] = [points[i - 1], points[i], points[i + 1]];
    const lengthBefore = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const lengthAfter = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, lengthBefore / 2, lengthAfter / 2);
    const startX = corner.x - ((corner.x - prev.x) / lengthBefore) * r;
    const startY = corner.y - ((corner.y - prev.y) / lengthBefore) * r;
    const endX = corner.x + ((next.x - corner.x) / lengthAfter) * r;
    const endY = corner.y + ((next.y - corner.y) / lengthAfter) * r;
    path += ` L ${startX},${startY} Q ${corner.x},${corner.y} ${endX},${endY}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x},${last.y}`;
}

// Renders an edge along the route computed by dagre. Using React Flow's built-in edge types
// would ignore that route, so edges and their labels would cut through other nodes.
function DagEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
  markerEnd,
}: EdgeProps<DagEdgeData>) {
  // dagre's first and last points lie somewhere on the node border, so replace them
  // with the actual handle positions.
  const innerPoints = data?.points.slice(1, -1) ?? [];
  const path = getRoundedCornerPath(
    getOrthogonalPoints([{ x: sourceX, y: sourceY }, ...innerPoints, { x: targetX, y: targetY }]),
    EDGE_CORNER_RADIUS,
  );
  return (
    <>
      <BaseEdge path={path} style={style} markerEnd={markerEnd} />
      {data?.labelPosition != null && data.label !== "" ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${data.labelPosition.x}px, ${data.labelPosition.y}px)`,
              fontSize: EDGE_LABEL_FONT_SIZE,
              lineHeight: `${EDGE_LABEL_HEIGHT - 2}px`,
              padding: `0 ${EDGE_LABEL_PADDING_X}px`,
              whiteSpace: "nowrap",
              color: data.labelColor,
              background: data.labelBackgroundColor,
              border: `1px solid ${data.labelBorderColor}`,
              borderRadius: 2,
              opacity: data.opacity,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = { dag: DagEdge };

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

const getNodeBorderWidth = (node: VoxelyticsWorkflowDagNode) => (node.isMetaTask ? 2 : 1);

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
  // React Flow renders parts of the graph via SVG presentation attributes (e.g. the
  // <rect stroke> behind an edge label), where a `var(--ant-…)` reference is not resolved.
  // So the border color has to be passed in as an already-resolved value.
  borderColor: string,
) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const filteredTaskNames = filteredTasks.map((task) => task.taskName);

  const nodeMap = new Map<string, DagNodeMapItem>();
  const edgeMap = new Map<string, DagEdgeMapItem>();

  dag.edges.forEach((edge) => {
    const { source, target } = edge;
    addAsHasOutput(nodeMap, source);
    addAsHasInput(nodeMap, target);
    addEdgeToMap(edgeMap, edge);
  });

  // Calculate layout with "dagre". Edge labels are passed in with their size, so that
  // dagre reserves space for them and they don't overlap with nodes or other labels.
  dagreGraph.setGraph({ rankdir: "TB", nodesep: 30, edgesep: 15, ranksep: 40 });
  dag.nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: getNodeWidth(node.label) + getNodeBorderWidth(node) * 2,
      height: NODE_HEIGHT,
    });
  });
  for (const edge of edgeMap.values()) {
    const label = edge.labels.join(", ");
    dagreGraph.setEdge(edge.source, edge.target, {
      width: label === "" ? 0 : getEdgeLabelWidth(label),
      height: label === "" ? 0 : EDGE_LABEL_HEIGHT,
      labelpos: "c",
    });
  }
  dagre.layout(dagreGraph);

  const nodes: Array<FlowNode> = dag.nodes.map((node) => {
    const nodeType = getNodeType(nodeMap.get(node.id) ?? null);

    let color = borderColor;
    let opacity = 100;

    const fontColor = colorHasher.hex(
      filteredTasks.find((t) => t.taskName === node.id)?.task ?? "",
    );

    const borderWidth = getNodeBorderWidth(node);
    const nodeWidth = getNodeWidth(node.label) + borderWidth * 2;
    const position = dagreGraph.node(node.id);

    switch (node.state) {
      // The two run-state colors are a fixed data-visualization palette that must stay
      // recognizable (and identical) in both themes, so they are deliberately not theme tokens.
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
        y: position.y - NODE_HEIGHT / 2,
      },
      data: { label: node.label },
      connectable: false,
      type: nodeType,
      style: {
        borderColor: color,
        borderStyle: node.isMetaTask ? "dashed" : "default",
        borderWidth,
        opacity,
        color: fontColor,
        width: nodeWidth,
        height: NODE_HEIGHT,
        padding: `0 ${NODE_PADDING}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
        fontSize: NODE_FONT_SIZE,
        backgroundColor: theme === "light" ? "white" : "black",
      },
    };
  });

  const edges: Array<FlowEdge<DagEdgeData>> = [];

  for (const [id, edge] of edgeMap.entries()) {
    const { source, target } = edge;
    const opacity = filteredTaskNames.includes(source) ? 1 : 0.4;
    const isSourceSelected = selectedNodeId === source;
    const strokeWidth = isSourceSelected ? 3 : 1;
    const labelFontColor = isSourceSelected ? "red" : null;
    const layoutEdge = dagreGraph.edge(source, target);

    edges.push({
      id,
      source,
      target,
      data: {
        points: layoutEdge.points,
        label: edge.labels.join(", "),
        labelPosition:
          layoutEdge.x != null && layoutEdge.y != null
            ? { x: layoutEdge.x, y: layoutEdge.y }
            : null,
        labelColor: labelFontColor ?? (theme === "light" ? "black" : "white"),
        labelBackgroundColor: theme === "light" ? "white" : "black",
        labelBorderColor: borderColor,
        opacity,
      },
      style: { opacity, strokeWidth },
      type: "dag",
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
  const theme = useWkSelector((state) => state.uiInformation.theme);
  // Resolved token values, because React Flow passes these into SVG presentation
  // attributes where `var(--ant-…)` references are not resolved.
  const { token } = antdTheme.useToken();
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

  const handleSelectionChange = ({ nodes }: { nodes: Array<FlowNode>; edges: Array<FlowEdge> }) => {
    if (nodes.length === 0) {
      // user clicked on background
      setSelectedNodeId(null);
    }
  };

  const { nodes, edges } = getEdgesAndNodes(
    dag,
    filteredTasks,
    selectedNodeId,
    theme,
    token.colorBorder,
  );

  return (
    <ReactFlow
      snapToGrid
      nodes={nodes}
      edges={edges}
      edgeTypes={edgeTypes}
      fitView
      // The DAG is read-only, so none of React Flow's keyboard interactions are needed.
      // So disable them to the view crashing when having a key pressed and loosing window focus.
      deleteKeyCode={null}
      multiSelectionKeyCode={null}
      selectionKeyCode={null}
      zoomActivationKeyCode={null}
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
          return token.colorBorderSecondary;
        }}
        nodeColor={(n) => {
          if (n.style?.borderColor) return n.style.borderColor;
          return token.colorBgContainer;
        }}
        nodeBorderRadius={2}
      />
      <Background color={token.colorBorder} gap={16} />
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
