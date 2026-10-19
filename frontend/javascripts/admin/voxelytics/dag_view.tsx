import { ExpandOutlined, MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { theme as antdTheme, Button } from "antd";
import ColorHash from "color-hash";
import dagre from "dagre";
import { useWkSelector } from "libs/react_hooks";
import memoize from "lodash-es/memoize";
import { useMemo, useRef, useState } from "react";
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
import { WK_FONT } from "theme";
import {
  VoxelyticsRunState,
  type VoxelyticsTaskConfigWithName,
  type VoxelyticsWorkflowDag,
  type VoxelyticsWorkflowDagEdge,
  type VoxelyticsWorkflowDagNode,
} from "types/api_types";
import type { Theme } from "viewer/store";

export const colorHasher = new ColorHash({ lightness: [0.35, 0.5, 0.65] });

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
    ctx.font = `${fontSize}px ${WK_FONT}`;
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

const addToAdjacency = (map: Map<string, Array<string>>, from: string, to: string) => {
  const neighbors = map.get(from);
  if (neighbors) {
    neighbors.push(to);
  } else {
    map.set(from, [to]);
  }
};

const getNodeBorderWidth = (node: Pick<VoxelyticsWorkflowDagNode, "isMetaTask">) =>
  node.isMetaTask ? 2 : 1;

const getNodeType = (e: DagNodeMapItem | null) => {
  if (e == null || (e.hasInput && e.hasOutput)) {
    return "default";
  } else if (e.hasInput) {
    return "output";
  } else {
    return "input";
  }
};

// Only the parts of the DAG that affect the layout.
type DagLayoutInput = {
  nodes: Array<Pick<VoxelyticsWorkflowDagNode, "id" | "label" | "isMetaTask">>;
  edges: Array<VoxelyticsWorkflowDagEdge>;
};

type DagLayout = {
  // Identifies the graph structure that this layout was computed for.
  key: string;
  nodes: Map<
    string,
    { position: Point; width: number; borderWidth: number; type: ReturnType<typeof getNodeType> }
  >;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label: string;
    points: Array<Point>;
    labelPosition: Point | null;
  }>;
  successors: Map<string, Array<string>>;
  predecessors: Map<string, Array<string>>;
};

function getLayoutInput(dag: VoxelyticsWorkflowDag): DagLayoutInput {
  return {
    nodes: dag.nodes.map(({ id, label, isMetaTask }) => ({ id, label, isMetaTask })),
    edges: dag.edges.map(({ source, target, label }) => ({ source, target, label })),
  };
}

function computeLayout(key: string): DagLayout {
  const { nodes, edges }: DagLayoutInput = JSON.parse(key);
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const nodeMap = new Map<string, DagNodeMapItem>();
  const edgeMap = new Map<string, DagEdgeMapItem>();
  const successors = new Map<string, Array<string>>();
  const predecessors = new Map<string, Array<string>>();

  edges.forEach((edge) => {
    const { source, target } = edge;
    addAsHasOutput(nodeMap, source);
    addAsHasInput(nodeMap, target);
    addEdgeToMap(edgeMap, edge);
  });
  for (const { source, target } of edgeMap.values()) {
    addToAdjacency(successors, source, target);
    addToAdjacency(predecessors, target, source);
  }

  // Calculate layout with "dagre". Edge labels are passed in with their size, so that
  // dagre reserves space for them and they don't overlap with nodes or other labels.
  dagreGraph.setGraph({ rankdir: "TB", nodesep: 30, edgesep: 15, ranksep: 40 });
  nodes.forEach((node) => {
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

  const layoutNodes: DagLayout["nodes"] = new Map();
  for (const node of nodes) {
    const borderWidth = getNodeBorderWidth(node);
    const width = getNodeWidth(node.label) + borderWidth * 2;
    const center = dagreGraph.node(node.id);
    layoutNodes.set(node.id, {
      position: { x: center.x - width / 2, y: center.y - NODE_HEIGHT / 2 },
      width,
      borderWidth,
      type: getNodeType(nodeMap.get(node.id) ?? null),
    });
  }

  const layoutEdges = Array.from(edgeMap.entries(), ([id, edge]) => {
    const layoutEdge = dagreGraph.edge(edge.source, edge.target);
    return {
      id,
      source: edge.source,
      target: edge.target,
      label: edge.labels.join(", "),
      points: layoutEdge.points,
      labelPosition:
        layoutEdge.x != null && layoutEdge.y != null ? { x: layoutEdge.x, y: layoutEdge.y } : null,
    };
  });

  return { key, nodes: layoutNodes, edges: layoutEdges, successors, predecessors };
}

// Laying out the DAG is expensive, so it is only recomputed when the graph structure changes,
// not when only run states (e.g., while polling a running workflow) or the selection change.
function useDagLayout(dag: VoxelyticsWorkflowDag): DagLayout {
  const layoutInputKey = JSON.stringify(getLayoutInput(dag));
  return useMemo(() => computeLayout(layoutInputKey), [layoutInputKey]);
}

function collectReachable(startId: string, adjacency: Map<string, Array<string>>): Set<string> {
  const reached = new Set<string>();
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const next of adjacency.get(id) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        stack.push(next);
      }
    }
  }
  return reached;
}

type TaskChain = { selected: string; upstream: Set<string>; downstream: Set<string> };

// All tasks the selected task (transitively) depends on and all tasks that depend on it.
function getTaskChain(layout: DagLayout, selectedNodeId: string | null): TaskChain | null {
  if (selectedNodeId == null || !layout.nodes.has(selectedNodeId)) {
    return null;
  }
  return {
    selected: selectedNodeId,
    upstream: collectReachable(selectedNodeId, layout.predecessors),
    downstream: collectReachable(selectedNodeId, layout.successors),
  };
}

const isNodeInChain = (chain: TaskChain, id: string) =>
  id === chain.selected || chain.upstream.has(id) || chain.downstream.has(id);

const isEdgeInChain = (chain: TaskChain, source: string, target: string) =>
  (chain.upstream.has(source) && (target === chain.selected || chain.upstream.has(target))) ||
  (chain.downstream.has(target) && (source === chain.selected || chain.downstream.has(source)));

// The run-state colors are a fixed data-visualization palette that must stay recognizable
// (and identical) in both themes, so they are deliberately not theme tokens.
const RUN_STATE_COLORS: Partial<Record<VoxelyticsRunState, string>> = {
  [VoxelyticsRunState.COMPLETE]: "rgb(9, 210, 150)",
  [VoxelyticsRunState.RUNNING]: "rgb(22, 119, 255)",
  [VoxelyticsRunState.FAILED]: "rgb(254, 34, 45)",
  [VoxelyticsRunState.CANCELLED]: "rgb(254, 34, 45)",
  [VoxelyticsRunState.STALE]: "rgb(250, 140, 22)",
  [VoxelyticsRunState.SKIPPED]: "rgb(160, 160, 160)",
};

const FADED_OPACITY = 0.4;

function getEdgesAndNodes(
  dag: VoxelyticsWorkflowDag,
  layout: DagLayout,
  filteredTasks: Array<VoxelyticsTaskConfigWithName>,
  selectedNodeId: string | null,
  theme: Theme,
  // React Flow renders parts of the graph via SVG presentation attributes, where a
  // `var(--ant-…)` reference is not resolved. So colors have to be passed in as resolved values.
  colors: { border: string; highlight: string },
) {
  const filteredTaskTypes = new Map(filteredTasks.map((task) => [task.taskName, task.task]));
  const chain = getTaskChain(layout, selectedNodeId);

  const nodes: Array<FlowNode> = dag.nodes.map((node) => {
    const { position, width, borderWidth, type } = layout.nodes.get(node.id)!;
    const isFaded =
      (!filteredTaskTypes.has(node.id) && !node.isMetaTask) ||
      (chain != null && !isNodeInChain(chain, node.id));

    return {
      ...node,
      position,
      data: {
        label: <span title={`${node.label} (${node.state.toLowerCase()})`}>{node.label}</span>,
      },
      connectable: false,
      type,
      className: node.state === VoxelyticsRunState.RUNNING ? "dag-node-running" : undefined,
      style: {
        borderColor: RUN_STATE_COLORS[node.state] ?? colors.border,
        borderStyle: node.isMetaTask
          ? "dashed"
          : node.state === VoxelyticsRunState.SKIPPED
            ? "dotted"
            : "solid",
        borderWidth,
        opacity: isFaded ? FADED_OPACITY : 1,
        color: colorHasher.hex(filteredTaskTypes.get(node.id) ?? ""),
        width,
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

  const edges: Array<FlowEdge<DagEdgeData>> = layout.edges.map((edge) => {
    const { id, source, target } = edge;
    const isHighlighted = chain != null && isEdgeInChain(chain, source, target);
    const isFaded = !filteredTaskTypes.has(source) || (chain != null && !isHighlighted);
    const opacity = isFaded ? FADED_OPACITY : 1;

    return {
      id,
      source,
      target,
      data: {
        points: edge.points,
        label: edge.label,
        labelPosition: edge.labelPosition,
        labelColor: isHighlighted ? colors.highlight : theme === "light" ? "black" : "white",
        labelBackgroundColor: theme === "light" ? "white" : "black",
        labelBorderColor: isHighlighted ? colors.highlight : colors.border,
        opacity,
      },
      style: {
        opacity,
        strokeWidth: isHighlighted ? 2 : 1,
        stroke: isHighlighted ? colors.highlight : undefined,
      },
      type: "dag",
      animated: chain?.selected === source,
    };
  });
  return { nodes, edges };
}

const FIT_VIEW_OPTIONS = { maxZoom: 1.5 };

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
  const theme = useWkSelector((state) => state.uiInformation.theme);
  // Resolved token values, because React Flow passes these into SVG presentation
  // attributes where `var(--ant-…)` references are not resolved.
  const { token } = antdTheme.useToken();
  const reactFlowRef = useRef<ReactFlowInstance | null>(null);
  const layout = useDagLayout(dag);

  const handleNodeClick = (_event: any, element: FlowNode) => {
    if (selectedNodeId !== element.id) {
      setSelectedNodeId(element.id);
    } else {
      setSelectedNodeId(null);
    }

    if (layout.nodes.has(element.id)) {
      onClickHandler(element.id);
    }
  };

  const { nodes, edges } = getEdgesAndNodes(dag, layout, filteredTasks, selectedNodeId, theme, {
    border: token.colorBorder,
    highlight: token.colorPrimary,
  });

  return (
    <ReactFlow
      // Remount when the graph structure changes (e.g., when expanding or collapsing a meta
      // task), so that the new graph is fitted into view.
      key={layout.key}
      snapToGrid
      nodes={nodes}
      edges={edges}
      edgeTypes={edgeTypes}
      fitView
      // The DAG is read-only, so none of React Flow's keyboard interactions are needed.
      // So disable them to the view crashing when having a key pressed and losing window focus.
      deleteKeyCode={null}
      multiSelectionKeyCode={null}
      selectionKeyCode={null}
      zoomActivationKeyCode={null}
      fitViewOptions={FIT_VIEW_OPTIONS}
      minZoom={0.3}
      maxZoom={2}
      attributionPosition="bottom-left"
      onNodeClick={handleNodeClick}
      onPaneClick={() => setSelectedNodeId(null)}
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
