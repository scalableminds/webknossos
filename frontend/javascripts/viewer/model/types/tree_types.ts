import DiffableMap from "libs/diffable_map";
import type { AdditionalCoordinate } from "types/api_types";
import type { MetadataEntryProto } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import type { TreeType } from "viewer/constants";
import type EdgeCollection from "viewer/model/edge_collection";

export type MutableCommentType = {
  content: string;
  nodeId: number;
};
export type CommentType = Readonly<MutableCommentType>;

export type MutableEdge = {
  source: number;
  target: number;
};
export type Edge = Readonly<MutableEdge>;

export type MutableNode = {
  id: number;
  untransformedPosition: Vector3;
  additionalCoordinates: AdditionalCoordinate[] | null;
  rotation: Vector3;
  bitDepth: number;
  viewport: number;
  mag: number;
  radius: number;
  timestamp: number;
  interpolation: boolean;
};
export type Node = Readonly<MutableNode>;

export type MutableBranchPoint = {
  timestamp: number;
  nodeId: number;
};
export type BranchPoint = Readonly<MutableBranchPoint>;

export type MutableNodeMap = DiffableMap<number, MutableNode>;
export type NodeMap = DiffableMap<number, Node>;

// When changing MutableTree, remember to also update Tree
export type MutableTree = {
  treeId: number;
  groupId: number | null | undefined;
  color: Vector3;
  name: string;
  timestamp: number;
  comments: MutableCommentType[];
  branchPoints: MutableBranchPoint[];
  edges: EdgeCollection;
  isVisible: boolean;
  nodes: MutableNodeMap;
  type: TreeType;
  edgesAreVisible: boolean;
  metadata: MetadataEntryProto[];
};

// When changing Tree, remember to also update MutableTree
export type Tree = {
  readonly treeId: number;
  readonly groupId: number | null | undefined;
  readonly color: Vector3;
  readonly name: string;
  readonly timestamp: number;
  readonly comments: CommentType[];
  readonly branchPoints: BranchPoint[];
  readonly edges: EdgeCollection;
  readonly isVisible: boolean;
  readonly nodes: NodeMap;
  readonly type: TreeType;
  readonly edgesAreVisible: boolean;
  readonly metadata: MetadataEntryProto[];
};

export type TreeGroupTypeFlat = {
  readonly name: string;
  readonly groupId: number;
  // Only needed for legacy groups. The expansion state for newer groups
  // is stored within the userStates of a skeleton or volume tracing.
  readonly isExpanded?: boolean;
};

export type TreeGroup = TreeGroupTypeFlat & {
  readonly children: TreeGroup[];
};

export type MutableTreeGroup = {
  name: string;
  groupId: number;
  children: MutableTreeGroup[];
};

export class MutableTreeMap extends DiffableMap<number, MutableTree> {}
export class TreeMap extends DiffableMap<number, Tree> {}
