import { diffArrays } from "libs/utils";
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  Group,
  LineSegments,
  Object3D,
  Points,
  type RawShaderMaterial,
  RGBAFormat,
} from "three";
import type { AdditionalCoordinate } from "types/api_types";
import type { Vector3, Vector4 } from "viewer/constants";
import EdgeShader from "viewer/geometries/materials/edge_shader";
import NodeShader, {
  COLOR_TEXTURE_WIDTH,
  NodeTypes,
} from "viewer/geometries/materials/node_shader";
import { getZoomValue } from "viewer/model/accessors/flycam_accessor";
import { isAgglomerateDiffTree } from "viewer/model/helpers/agglomerate_diff_helpers";
import { cachedDiffTrees } from "viewer/model/sagas/skeletontracing_saga";
import type { CreateActionNode, UpdateActionNode } from "viewer/model/sagas/volume/update_actions";
import type { Edge, Node, Tree } from "viewer/model/types/tree_types";
import type { SkeletonTracing, WebknossosState } from "viewer/store";
import Store from "viewer/throttled_store";

const MAX_CAPACITY = 1000;
// Nodes and edges of priority trees are drawn after all other nodes and edges. Since the materials
// use the default LessEqual depth test, they win against coinciding nodes and edges of other trees.
// Otherwise, the transparent meshes would be sorted by their distance to the camera, so that the
// (dimmed) nodes of other trees would sometimes be blended over the priority nodes.
const PRIORITY_TREES_RENDER_ORDER = 1;
// While priority trees are visible, all other trees are dimmed to this opacity.
const DIMMED_TREE_OPACITY = 0.25;

type BufferGeometryWithBufferAttributes = BufferGeometry & {
  attributes: Record<string, BufferAttribute>;
};

type BufferHelper = typeof NodeBufferHelperType | typeof EdgeBufferHelperType;
type Buffer = {
  capacity: number;
  nextIndex: number;
  geometry: BufferGeometryWithBufferAttributes;
  mesh: Points | LineSegments;
};
type BufferPosition = {
  buffer: Buffer;
  index: number;
};
type BufferCollection = {
  buffers: Buffer[];
  idToBufferPosition: Map<string, BufferPosition>;
  freeList: BufferPosition[];
  helper: BufferHelper;
  material: RawShaderMaterial;
  renderOrder: number;
};

type BufferOperation = (position: BufferPosition) => BufferAttribute[];
const NodeBufferHelperType = {
  initializeAttributes(geometry: BufferGeometry, capacity: number): void {
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 3), 3));

    const additionalCoords = Store.getState().flycam.additionalCoordinates ?? [];
    for (const coord of additionalCoords) {
      geometry.setAttribute(
        `additionalCoord_${coord.name}`,
        new BufferAttribute(new Float32Array(capacity), 1),
      );
    }
    geometry.setAttribute("radius", new BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("type", new BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("isCommented", new BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("nodeId", new BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("treeId", new BufferAttribute(new Float32Array(capacity), 1));
  },

  buildMesh(geometry: BufferGeometry, material: RawShaderMaterial): Points {
    return new Points(geometry, material);
  },

  supportsPicking: true,
};

const EdgeBufferHelperType = {
  initializeAttributes(geometry: BufferGeometry, capacity: number): void {
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 2 * 3), 3));

    const additionalCoords = Store.getState().flycam.additionalCoordinates ?? [];
    for (const coord of additionalCoords) {
      geometry.setAttribute(
        `additionalCoord_${coord.name}`,
        new BufferAttribute(new Float32Array(capacity * 2), 1),
      );
    }

    geometry.setAttribute("treeId", new BufferAttribute(new Float32Array(capacity * 2), 1));
  },

  buildMesh(geometry: BufferGeometry, material: RawShaderMaterial): LineSegments {
    return new LineSegments(geometry, material);
  },

  supportsPicking: false,
};
/**
 * Creates and manages the WebGL buffers for drawing trees (nodes, edges).
 * Trees are not recreated on every store change in spite of the functional
 * react paradigm for performance reasons. Instead we identify more fine granular
 * actions like node creation/deletion/update etc.
 * Trees are stored in single, large buffers regardless of which skeleton they belong to.
 * Nodes are never deleted but marked as type "INVALID" and not drawn by the shader.
 * Nodes and edges of priority trees (see isPriorityTree) are kept in separate buffers which are
 * drawn last, so that they are visible even if they coincide with nodes and edges of other trees.
 * @class
 */

class Skeleton {
  rootGroup: Group;
  pickingNode: Object3D;
  supportsPicking: boolean;
  stopStoreListening: () => void;
  // The following properties are set in reset() which is called from the constructor.
  // Therefore, we use ! tell TS it's safe to assume non-null.
  prevTracing!: SkeletonTracing;
  nodes!: BufferCollection;
  edges!: BufferCollection;
  priorityNodes!: BufferCollection;
  priorityEdges!: BufferCollection;
  treeColorTexture!: DataTexture;

  nodeShader: NodeShader | undefined;
  edgeShader: EdgeShader | undefined;

  // See SceneController.deferUntilCompileReady for why disposal below must go through this.
  // Defaults to immediate execution for callers (e.g. tests) without a SceneController.
  private deferGpuDispose: (dispose: () => void) => void;

  constructor(
    skeletonTracingSelectorFn: (state: WebknossosState) => SkeletonTracing | null,
    supportsPicking: boolean,
    deferGpuDispose: (dispose: () => void) => void = (dispose) => dispose(),
  ) {
    this.supportsPicking = supportsPicking;
    this.deferGpuDispose = deferGpuDispose;
    this.rootGroup = new Group();
    this.pickingNode = new Object3D();
    const skeletonTracing = skeletonTracingSelectorFn(Store.getState());
    if (skeletonTracing != null) {
      this.reset(skeletonTracing);
    }
    this.stopStoreListening = Store.subscribe(() => {
      const skeletonTracing = skeletonTracingSelectorFn(Store.getState());
      if (skeletonTracing != null) {
        if (skeletonTracing.tracingId !== this.prevTracing.tracingId) {
          this.reset(skeletonTracing);
        } else {
          this.refresh(skeletonTracing);
        }
      }
    });
  }

  destroy() {
    this.stopStoreListening();
    this.stopStoreListening = () => {};

    const oldTreeColorTexture = this.treeColorTexture;
    const oldNodes = this.nodes;
    const oldEdges = this.edges;
    const oldPriorityNodes = this.priorityNodes;
    const oldPriorityEdges = this.priorityEdges;
    const oldNodeShader = this.nodeShader;
    const oldEdgeShader = this.edgeShader;
    // @ts-expect-error
    this.treeColorTexture = undefined;

    this.deferGpuDispose(() => {
      oldTreeColorTexture.dispose();

      oldNodes.material.dispose();
      oldEdges.material.dispose();

      oldNodeShader?.destroy();
      oldEdgeShader?.destroy();

      // Delete the actual GPU buffers. Otherwise, they would leak as three.js
      // only frees them on an explicit dispose() call.
      if (oldNodes != null) {
        for (const nodes of oldNodes.buffers) {
          nodes.geometry.dispose();
        }
      }

      if (oldEdges != null) {
        for (const edges of oldEdges.buffers) {
          edges.geometry.dispose();
        }
      }

      // The materials are shared with oldNodes and oldEdges.
      for (const collection of [oldPriorityNodes, oldPriorityEdges]) {
        for (const buffer of collection?.buffers ?? []) {
          buffer.geometry.dispose();
        }
      }
    });
  }

  reset(skeletonTracing: SkeletonTracing) {
    // Remove all existing geometries
    this.rootGroup.remove(...this.rootGroup.children);
    this.pickingNode.remove(...this.pickingNode.children);
    const { trees } = skeletonTracing;

    let nodeCount = 0;
    let edgeCount = 0;
    let priorityNodeCount = 0;
    let priorityEdgeCount = 0;
    for (const tree of trees.values()) {
      if (this.isPriorityTree(tree)) {
        priorityNodeCount += tree.nodes.size();
        priorityEdgeCount += tree.edges.size();
      } else {
        nodeCount += tree.nodes.size();
        edgeCount += tree.edges.size();
      }
    }

    // delete actual GPU buffers in case there were any
    const oldTreeColorTexture = this.treeColorTexture;
    const oldNodeShader = this.nodeShader;
    const oldEdgeShader = this.edgeShader;
    const oldNodes = this.nodes;
    const oldEdges = this.edges;
    const oldPriorityNodes = this.priorityNodes;
    const oldPriorityEdges = this.priorityEdges;
    this.deferGpuDispose(() => {
      if (oldTreeColorTexture != null) {
        oldTreeColorTexture.dispose();
      }
      oldNodeShader?.destroy();
      oldEdgeShader?.destroy();
      if (oldNodes != null) {
        oldNodes.material.dispose();
        for (const nodes of oldNodes.buffers) {
          nodes.geometry.dispose();
        }
      }
      if (oldEdges != null) {
        oldEdges.material.dispose();
        for (const edges of oldEdges.buffers) {
          edges.geometry.dispose();
        }
      }
      // The materials are shared with oldNodes and oldEdges.
      for (const collection of [oldPriorityNodes, oldPriorityEdges]) {
        for (const buffer of collection?.buffers ?? []) {
          buffer.geometry.dispose();
        }
      }
    });

    this.treeColorTexture = new DataTexture(
      new Float32Array(COLOR_TEXTURE_WIDTH * COLOR_TEXTURE_WIDTH * 4),
      COLOR_TEXTURE_WIDTH,
      COLOR_TEXTURE_WIDTH,
      RGBAFormat,
      FloatType,
    );
    this.nodeShader = new NodeShader(this.treeColorTexture);
    this.edgeShader = new EdgeShader(this.treeColorTexture);

    // create new buffers
    this.nodes = this.initializeBufferCollection(
      nodeCount,
      this.nodeShader.getMaterial(),
      NodeBufferHelperType,
    );
    this.edges = this.initializeBufferCollection(
      edgeCount,
      this.edgeShader.getMaterial(),
      EdgeBufferHelperType,
    );
    this.priorityNodes = this.initializeBufferCollection(
      priorityNodeCount,
      this.nodeShader.getMaterial(),
      NodeBufferHelperType,
      PRIORITY_TREES_RENDER_ORDER,
    );
    this.priorityEdges = this.initializeBufferCollection(
      priorityEdgeCount,
      this.edgeShader.getMaterial(),
      EdgeBufferHelperType,
      PRIORITY_TREES_RENDER_ORDER,
    );

    const flycamAdditionalCoordinateNames = new Set(
      (Store.getState().flycam.additionalCoordinates ?? []).map(({ name }) => name),
    );
    // fill buffers with data
    for (const tree of trees.values()) {
      this.createTree(tree, flycamAdditionalCoordinateNames);
    }

    this.computeBoundingSpheres();
    this.updateNonPriorityTreeOpacity(skeletonTracing);
    this.prevTracing = skeletonTracing;
  }

  computeBoundingSpheres() {
    // compute bounding sphere to make ThreeJS happy
    for (const collection of [this.nodes, this.edges, this.priorityNodes, this.priorityEdges]) {
      for (const buffer of collection.buffers) {
        buffer.geometry.computeBoundingSphere();
      }
    }
  }

  initializeBufferCollection(
    initialCapacity: number,
    material: RawShaderMaterial,
    helper: BufferHelper,
    renderOrder: number = 0,
  ): BufferCollection {
    const initialBuffer = this.initializeBuffer(
      Math.max(initialCapacity, MAX_CAPACITY),
      material,
      helper,
      renderOrder,
    );
    return {
      buffers: [initialBuffer],
      idToBufferPosition: new Map(),
      freeList: [],
      helper,
      material,
      renderOrder,
    };
  }

  initializeBuffer(
    capacity: number,
    material: RawShaderMaterial,
    helper: BufferHelper,
    renderOrder: number,
  ): Buffer {
    const geometry = new BufferGeometry() as BufferGeometryWithBufferAttributes;
    helper.initializeAttributes(geometry, capacity);
    const mesh = helper.buildMesh(geometry, material);
    mesh.renderOrder = renderOrder;
    // Frustum culling is disabled because nodes that are transformed
    // wouldn't be culled correctly.
    // In basic testing, culling didn't provide a noticeable performance
    // improvement (tested with 500k skeleton nodes).
    mesh.frustumCulled = false;
    this.rootGroup.add(mesh);

    if (helper.supportsPicking) {
      const pickingMesh = helper.buildMesh(geometry, material);
      pickingMesh.frustumCulled = false;
      this.pickingNode.add(pickingMesh);
    }

    return {
      capacity,
      nextIndex: 0,
      geometry,
      mesh,
    };
  }

  /**
   * Creates or reuses the WebGL buffers depending on how much capacity is left.
   * @param id - Id of a node or edge to look up its corresponding buffer
   * @param collection - collection of all buffers
   * @param createFunc - callback(buffer, index) that actually creates a node / edge
   */
  create(id: string, collection: BufferCollection, createFunc: BufferOperation) {
    let currentBuffer = collection.buffers[0];

    if (collection.freeList.length === 0 && currentBuffer.nextIndex >= currentBuffer.capacity) {
      currentBuffer = this.initializeBuffer(
        MAX_CAPACITY,
        collection.material,
        collection.helper,
        collection.renderOrder,
      );
      collection.buffers.unshift(currentBuffer);
    }

    const bufferPosition = collection.freeList.pop() || {
      buffer: currentBuffer,
      index: currentBuffer.nextIndex++,
    };
    collection.idToBufferPosition.set(id, bufferPosition);
    const changedAttributes = createFunc(bufferPosition);

    for (const attribute of changedAttributes) {
      attribute.needsUpdate = true;
    }
  }

  /**
   * Finds the corresponding WebGL buffer for a node/edge for deletion/invalidation
   * @param id - Id of a node or edge to look up its corresponding buffer
   * @param collection - collection of all buffers
   * @param deleteFunc - callback(buffer, index) that actually deletes/invalidates a node / edge
   */
  delete(id: string, collection: BufferCollection, deleteFunc: BufferOperation) {
    const bufferPosition = collection.idToBufferPosition.get(id);

    if (bufferPosition != null) {
      const changedAttributes = deleteFunc(bufferPosition);

      for (const attribute of changedAttributes) {
        attribute.needsUpdate = true;
      }

      collection.idToBufferPosition.delete(id);
      collection.freeList.push(bufferPosition);
    } else {
      console.warn(`[Skeleton] Unable to find buffer position for id ${id}`);
    }
  }

  /**
   * Finds the corresponding WebGL buffer for a node/edge for updates
   * @param id - Id of a node or edge to look up its corresponding buffer
   * @param collection - collection of all buffers
   */
  update(id: string, collection: BufferCollection, updateFunc: BufferOperation) {
    const bufferPosition = collection.idToBufferPosition.get(id);

    if (bufferPosition != null) {
      const changedAttributes = updateFunc(bufferPosition);

      for (const attribute of changedAttributes) {
        attribute.needsUpdate = true;
      }
    } else {
      console.warn(`[Skeleton] Unable to find buffer position for id ${id}`);
    }
  }

  /**
   * Called on every store update. Diffs the old and new skeleton to identify
   * the changes and manipulate the WebGL buffers more fine granularly instead
   * of replacing them completely on every change.
   */
  refresh(skeletonTracing: SkeletonTracing) {
    const state = Store.getState();
    const diff = cachedDiffTrees(
      skeletonTracing.tracingId,
      this.prevTracing.trees,
      skeletonTracing.trees,
      false,
    );

    const flycamAdditionalCoordinateNames = new Set(
      (state.flycam.additionalCoordinates ?? []).map(({ name }) => name),
    );

    for (const update of diff) {
      switch (update.name) {
        case "createNode": {
          const { treeId, id: nodeId } = update.value;
          const tree = skeletonTracing.trees.getOrThrow(treeId);
          this.createNode(tree, update.value, flycamAdditionalCoordinateNames);
          const isBranchpoint = tree.branchPoints.find((bp) => bp.nodeId === nodeId) != null;

          if (isBranchpoint) {
            this.updateNodeType(treeId, nodeId, NodeTypes.BRANCH_POINT);
          }

          const isCommented = tree.comments.find((bp) => bp.nodeId === nodeId) != null;

          if (isCommented) {
            this.updateIsCommented(treeId, nodeId, true);
          }

          break;
        }

        case "deleteNode": {
          this.deleteNode(update.value.treeId, update.value.nodeId);
          break;
        }

        case "createEdge": {
          const tree = skeletonTracing.trees.getOrThrow(update.value.treeId);
          const source = tree.nodes.getOrThrow(update.value.source);
          const target = tree.nodes.getOrThrow(update.value.target);
          this.createEdge(tree, source, target, flycamAdditionalCoordinateNames);
          break;
        }

        case "deleteEdge": {
          this.deleteEdge(update.value.treeId, update.value.source, update.value.target);
          break;
        }

        case "updateNode": {
          const { treeId, id, radius, position, additionalCoordinates } = update.value;
          this.updateNodeRadius(treeId, id, radius);
          const tree = skeletonTracing.trees.getOrThrow(treeId);
          this.updateNodePosition(
            tree,
            id,
            position,
            additionalCoordinates,
            flycamAdditionalCoordinateNames,
          );
          break;
        }

        case "createTree": {
          this.updateTreeColor(skeletonTracing.trees.getOrThrow(update.value.id));
          break;
        }

        case "updateTreeVisibility":
        case "updateTreeEdgesVisibility": {
          this.updateTreeColor(skeletonTracing.trees.getOrThrow(update.value.treeId));
          break;
        }

        case "updateTree": {
          // Helper function to act on created or deleted elements
          const forEachCreatedOrDeletedId = <
            T extends {
              readonly nodeId: number;
            },
          >(
            oldElements: Array<T>,
            newElements: Array<T>,
            callback: (arg0: number, arg1: boolean) => void,
          ) => {
            const oldIds = oldElements.map((el) => el.nodeId);
            const newIds = newElements.map((el) => el.nodeId);
            const { onlyA: deletedIds, onlyB: createdIds } = diffArrays(oldIds, newIds);
            createdIds.forEach((id) => {
              callback(id, true);
            });
            deletedIds.forEach((id) => {
              callback(id, false);
            });
          };

          const treeId = update.value.id;
          const tree = skeletonTracing.trees.getOrThrow(treeId);
          const prevTree = this.prevTracing.trees.getOrThrow(treeId);

          forEachCreatedOrDeletedId(prevTree.branchPoints, tree.branchPoints, (id, isCreated) => {
            this.updateNodeType(treeId, id, isCreated ? NodeTypes.BRANCH_POINT : NodeTypes.NORMAL);
          });

          forEachCreatedOrDeletedId(prevTree.comments, tree.comments, (id, isCreated) => {
            this.updateIsCommented(treeId, id, isCreated);
          });

          const hasPriorityChanged = this.isPriorityTree(tree) !== this.isPriorityTree(prevTree);
          if (tree.color !== prevTree.color || hasPriorityChanged) {
            this.updateTreeColor(tree);
          }

          if (hasPriorityChanged) {
            this.moveToMatchingCollections(tree, flycamAdditionalCoordinateNames);
          }

          break;
        }

        case "deleteTree":
        case "moveTreeComponent":
        case "mergeTree":
          // Unused for now
          break;

        default:
          throw new Error(`[Skeleton] Unhandled skeletontracing diff action: ${update.name}`);
      }
    }

    if (diff.length > 0) {
      this.computeBoundingSpheres();
    }

    // Uniforms
    const { particleSize, overrideNodeRadius } = state.userConfiguration;
    let { activeNodeId } = skeletonTracing;
    activeNodeId = activeNodeId == null ? -1 : activeNodeId;

    let { activeTreeId } = state.localSkeletonState;
    activeTreeId = activeTreeId == null ? -1 : activeTreeId;

    const nodeUniforms = this.nodes.material.uniforms;
    nodeUniforms.planeZoomFactor.value = getZoomValue(state.flycam);
    nodeUniforms.overrideParticleSize.value = particleSize;
    nodeUniforms.overrideNodeRadius.value = overrideNodeRadius;
    nodeUniforms.activeTreeId.value = activeTreeId;
    nodeUniforms.activeNodeId.value = activeNodeId;

    const edgeUniforms = this.edges.material.uniforms;
    edgeUniforms.activeTreeId.value = activeTreeId;
    this.edges.material.linewidth = state.userConfiguration.particleSize / 4;

    if (skeletonTracing.trees !== this.prevTracing.trees) {
      this.updateNonPriorityTreeOpacity(skeletonTracing);
    }
    this.prevTracing = skeletonTracing;
  }

  /**
   * Dims all other trees while priority trees are visible, so that the priority trees stand out.
   * Hiding the priority trees therefore restores the normal appearance.
   */
  updateNonPriorityTreeOpacity(skeletonTracing: SkeletonTracing) {
    const hasVisiblePriorityTrees = skeletonTracing.trees
      .values()
      .some((tree) => tree.isVisible && this.isPriorityTree(tree));
    const opacity = hasVisiblePriorityTrees ? DIMMED_TREE_OPACITY : 1;
    this.nodes.material.uniforms.nonPriorityTreeOpacity.value = opacity;
    this.edges.material.uniforms.nonPriorityTreeOpacity.value = opacity;
  }

  getAllNodes(): Object3D[] {
    return [...this.nodes.buffers, ...this.priorityNodes.buffers].map((buffer) => buffer.mesh);
  }

  // Updates the section-clipping uniforms on the node and edge shaders. This is
  // called once per render pass (per viewport), see SceneController.updateSceneForCam.
  // clippingAxis is the perpendicular axis of the rendered viewport (0/1/2), or
  // -1 to disable section clipping for this pass.
  setSectionClippingUniforms(clippingAxis: number, flycamPosition: Vector3): void {
    for (const uniforms of [this.nodes.material.uniforms, this.edges.material.uniforms]) {
      uniforms.clippingAxis.value = clippingAxis;
      uniforms.currentSectionFlycamPosition.value = flycamPosition;
    }
  }

  getRootGroup(): Object3D {
    return this.rootGroup;
  }

  startPicking(isTouch: boolean): Object3D {
    this.pickingNode.matrixAutoUpdate = false;
    this.pickingNode.matrix.copy(this.rootGroup.matrixWorld);
    this.nodes.material.uniforms.isTouch.value = isTouch ? 1 : 0;
    this.nodes.material.uniforms.isPicking.value = 1;
    return this.pickingNode;
  }

  stopPicking(): void {
    this.nodes.material.uniforms.isTouch.value = 0;
    this.nodes.material.uniforms.isPicking.value = 0;
  }

  // ######### API ###############

  /**
   * Combine node, edge and tree ids to a single unique id.
   * @param numbers - Array of node/edge id and treeId
   */
  combineIds(...numbers: number[]): string {
    return numbers.join(",");
  }

  /**
   * Utility function to create a complete tree.
   * Usually called only once initially.
   */
  createTree(tree: Tree, flycamAdditionalCoordinateNames: Set<string>) {
    const isPriorityTree = this.isPriorityTree(tree);
    for (const node of tree.nodes.values()) {
      this.createNode(tree, node, flycamAdditionalCoordinateNames, isPriorityTree);
    }

    this.updateNodeTypesAndComments(tree);

    for (const edge of tree.edges.all()) {
      const source = tree.nodes.getOrThrow(edge.source);
      const target = tree.nodes.getOrThrow(edge.target);
      this.createEdge(tree, source, target, flycamAdditionalCoordinateNames, isPriorityTree);
    }

    this.updateTreeColor(tree);
  }

  updateNodeTypesAndComments(tree: Tree) {
    for (const branchpoint of tree.branchPoints) {
      this.updateNodeType(tree.treeId, branchpoint.nodeId, NodeTypes.BRANCH_POINT);
    }

    for (const comment of tree.comments) {
      this.updateIsCommented(tree.treeId, comment.nodeId, true);
    }
  }

  /**
   * Creates a new node in a WebGL buffer. When creating many nodes of a tree, pass isPriorityTree
   * to avoid checking it for every node.
   */
  createNode(
    tree: Tree,
    node: Node | UpdateActionNode | CreateActionNode,
    flycamAdditionalCoordinateNames: Set<string>,
    isPriorityTree: boolean = this.isPriorityTree(tree),
  ) {
    const { treeId } = tree;
    const id = this.combineIds(node.id, treeId);
    const collection = isPriorityTree ? this.priorityNodes : this.nodes;
    this.create(id, collection, ({ buffer, index }: BufferPosition): BufferAttribute[] => {
      const attributes = buffer.geometry.attributes;
      const untransformedPosition =
        "untransformedPosition" in node ? node.untransformedPosition : node.position;
      attributes.position.set(untransformedPosition, index * 3);

      if (flycamAdditionalCoordinateNames.size > 0) {
        const nodeCoords = node.additionalCoordinates ?? [];
        const nodeCoordMap = new Map(nodeCoords.map((c) => [c.name, c.value]));

        for (const name of flycamAdditionalCoordinateNames) {
          const attribute = buffer.geometry.attributes[`additionalCoord_${name}`];
          const value = nodeCoordMap.get(name) ?? NaN;
          attribute.set([value], index);
        }
      }
      attributes.radius.array[index] = node.radius;
      attributes.type.array[index] = NodeTypes.NORMAL;
      // @ts-expect-error ts-migrate(2542) FIXME: Index signature in type 'any[] | ArrayLike<number>... Remove this comment to see the full error message
      attributes.isCommented.array[index] = false;
      attributes.nodeId.array[index] = node.id;
      attributes.treeId.array[index] = treeId;
      return Object.values(attributes);
    });
  }

  /**
   * Delete/invalidates a node in a WebGL buffer.
   */
  deleteNode(treeId: number, nodeId: number) {
    const id = this.combineIds(nodeId, treeId);
    this.delete(id, this.getNodeCollection(id), ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.type;
      attribute.array[index] = NodeTypes.INVALID;
      return [attribute];
    });
  }

  /**
   * Updates a node's radius in a WebGL buffer.
   */
  updateNodeRadius(treeId: number, nodeId: number, radius: number) {
    const id = this.combineIds(nodeId, treeId);
    this.update(id, this.getNodeCollection(id), ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.radius;
      attribute.array[index] = radius;
      return [attribute];
    });
  }

  /**
   * Updates a node's position and that of its edges in a WebGL buffer.
   */
  updateNodePosition(
    tree: Tree,
    nodeId: number,
    position: Vector3,
    additionalCoordinates: AdditionalCoordinate[] | null | undefined,
    flycamAdditionalCoordinateNames: Set<string>,
  ) {
    const { treeId } = tree;
    const bufferNodeId = this.combineIds(nodeId, treeId);
    this.update(bufferNodeId, this.getNodeCollection(bufferNodeId), ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.position;
      attribute.set(position, index * 3);
      const updatedAttributes = [attribute];

      if (flycamAdditionalCoordinateNames.size > 0) {
        const nodeCoords = additionalCoordinates ?? [];
        const nodeCoordMap = new Map(nodeCoords.map((c) => [c.name, c.value]));

        for (const name of flycamAdditionalCoordinateNames) {
          const attribute = buffer.geometry.attributes[`additionalCoord_${name}`];
          const value = nodeCoordMap.get(name) ?? NaN;
          attribute.set([value], index);
          updatedAttributes.push(attribute);
        }
      }

      return updatedAttributes;
    });

    const edgePositionUpdater = (edge: Edge, isIngoingEdge: boolean) => {
      // If isIngoingEdge is true, the changed node is the target node of the
      // (source, target) edge. Thus, we need an offset.
      const indexOffset = isIngoingEdge ? 3 : 0;
      const bufferEdgeId = this.combineIds(treeId, edge.source, edge.target);
      this.update(bufferEdgeId, this.getEdgeCollection(bufferEdgeId), ({ buffer, index }) => {
        const { attributes } = buffer.geometry;
        const positionAttribute = attributes.position;
        positionAttribute.set(position, index * 6 + indexOffset);
        const updatedAttributes = [positionAttribute];

        if (flycamAdditionalCoordinateNames.size > 0) {
          const source = tree.nodes.getOrThrow(edge.source);
          const target = tree.nodes.getOrThrow(edge.target);
          const sourceCoordMap = new Map(
            (source.additionalCoordinates ?? []).map((c) => [c.name, c.value]),
          );
          const targetCoordMap = new Map(
            (target.additionalCoordinates ?? []).map((c) => [c.name, c.value]),
          );

          for (const name of flycamAdditionalCoordinateNames) {
            const additionalCoordAttribute = attributes[`additionalCoord_${name}`];

            additionalCoordAttribute.set([sourceCoordMap.get(name) ?? NaN], 2 * index);
            additionalCoordAttribute.set([targetCoordMap.get(name) ?? NaN], 2 * index + 1);
            updatedAttributes.push(additionalCoordAttribute);
          }
        }

        return updatedAttributes;
      });
    };

    for (const edge of tree.edges.getOutgoingEdgesForNode(nodeId)) {
      edgePositionUpdater(edge, false);
    }

    for (const edge of tree.edges.getIngoingEdgesForNode(nodeId)) {
      edgePositionUpdater(edge, true);
    }
  }

  /**
   * Updates a node's type in a WebGL buffer.
   * @param type - Either of INVALID, NORMAL, BRANCH_POINT
   */
  updateNodeType(treeId: number, nodeId: number, type: number) {
    const id = this.combineIds(nodeId, treeId);
    this.update(id, this.getNodeCollection(id), ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.type;
      attribute.array[index] = type;
      return [attribute];
    });
  }

  updateIsCommented(treeId: number, nodeId: number, isCommented: boolean) {
    const id = this.combineIds(nodeId, treeId);
    this.update(id, this.getNodeCollection(id), ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.isCommented;
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'boolean' is not assignable to type 'number'.
      attribute.array[index] = isCommented;
      return [attribute];
    });
  }

  /**
   * Creates a new edge in a WebGL buffer. When creating many edges of a tree, pass isPriorityTree
   * to avoid checking it for every edge.
   */
  createEdge(
    tree: Tree,
    source: Node,
    target: Node,
    flycamAdditionalCoordinateNames: Set<string>,
    isPriorityTree: boolean = this.isPriorityTree(tree),
  ) {
    const { treeId } = tree;
    const id = this.combineIds(treeId, source.id, target.id);
    const collection = isPriorityTree ? this.priorityEdges : this.edges;

    this.create(id, collection, ({ buffer, index }) => {
      const { attributes } = buffer.geometry;
      const positionAttribute = attributes.position;
      const treeIdAttribute = attributes.treeId;

      // Each position needs 3 items (x, y, z). Per edge, there are two
      // positions, which explains the ... * 6 + 3 calculation.
      positionAttribute.set(source.untransformedPosition, index * 6);
      positionAttribute.set(target.untransformedPosition, index * 6 + 3);
      treeIdAttribute.set([treeId, treeId], index * 2);

      const changedAttributes = [];
      if (flycamAdditionalCoordinateNames.size > 0) {
        const sourceCoordMap = new Map(
          (source.additionalCoordinates ?? []).map((c) => [c.name, c.value]),
        );
        const targetCoordMap = new Map(
          (target.additionalCoordinates ?? []).map((c) => [c.name, c.value]),
        );

        for (const name of flycamAdditionalCoordinateNames) {
          const additionalCoordAttribute = attributes[`additionalCoord_${name}`];

          additionalCoordAttribute.set([sourceCoordMap.get(name) ?? NaN], 2 * index);
          additionalCoordAttribute.set([targetCoordMap.get(name) ?? NaN], 2 * index + 1);
          changedAttributes.push(additionalCoordAttribute);
        }
      }

      return [positionAttribute, treeIdAttribute, ...changedAttributes];
    });
  }

  /**
   * Deletes/invalidates an edge in a WebGL buffer by changing the source and
   * target node to [0, 0, 0]. Hence it is not drawn by the GPU.
   */
  deleteEdge(treeId: number, sourceId: number, targetId: number) {
    const id = this.combineIds(treeId, sourceId, targetId);
    this.delete(id, this.getEdgeCollection(id), ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.position;
      attribute.set([0, 0, 0, 0, 0, 0], index * 6);
      return [attribute];
    });
  }

  isPriorityTree(tree: Tree): boolean {
    return isAgglomerateDiffTree(tree);
  }

  /**
   * Returns the collection that holds the node with the given id.
   */
  getNodeCollection(nodeId: string): BufferCollection {
    return this.priorityNodes.idToBufferPosition.has(nodeId) ? this.priorityNodes : this.nodes;
  }

  /**
   * Returns the collection that holds the edge with the given id.
   */
  getEdgeCollection(edgeId: string): BufferCollection {
    return this.priorityEdges.idToBufferPosition.has(edgeId) ? this.priorityEdges : this.edges;
  }

  /**
   * Moves the nodes and edges of a tree whose priority changed to the matching buffer collections.
   */
  moveToMatchingCollections(tree: Tree, flycamAdditionalCoordinateNames: Set<string>) {
    const isPriorityTree = this.isPriorityTree(tree);
    const targetNodeCollection = isPriorityTree ? this.priorityNodes : this.nodes;
    for (const node of tree.nodes.values()) {
      if (targetNodeCollection.idToBufferPosition.has(this.combineIds(node.id, tree.treeId)))
        continue;
      this.deleteNode(tree.treeId, node.id);
      this.createNode(tree, node, flycamAdditionalCoordinateNames, isPriorityTree);
    }
    this.updateNodeTypesAndComments(tree);

    const targetEdgeCollection = isPriorityTree ? this.priorityEdges : this.edges;
    for (const edge of tree.edges.all()) {
      const id = this.combineIds(tree.treeId, edge.source, edge.target);
      if (targetEdgeCollection.idToBufferPosition.has(id)) continue;
      this.deleteEdge(tree.treeId, edge.source, edge.target);
      const source = tree.nodes.getOrThrow(edge.source);
      const target = tree.nodes.getOrThrow(edge.target);
      this.createEdge(tree, source, target, flycamAdditionalCoordinateNames, isPriorityTree);
    }
  }

  /**
   * Updates a node/edge's color based on the tree color. Colors are stored in
   * a texture shared between the node and edge shader.
   */
  updateTreeColor(tree: Tree) {
    const rgba = this.getTreeRGBA(
      tree.color,
      tree.isVisible,
      tree.edgesAreVisible,
      this.isPriorityTree(tree),
    );
    this.treeColorTexture.image.data.set(rgba, tree.treeId * 4);
    this.treeColorTexture.needsUpdate = true;
  }

  getTreeRGBA(
    color: Vector3,
    isVisible: boolean,
    areEdgesVisible: boolean,
    isPriorityTree: boolean = false,
  ): Vector4 {
    // The alpha channel encodes the visibility: 1 = visible, 0.5 = only nodes visible, 0 = invisible.
    // Priority trees are marked by a negative sign, so that the shaders can tell them apart.
    const alpha = isVisible ? (areEdgesVisible ? 1 : 0.5) : 0;
    return [...color, isPriorityTree ? -alpha : alpha];
  }
}

export default Skeleton;
