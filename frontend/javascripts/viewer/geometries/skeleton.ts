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
import { getRenderer } from "viewer/controller/renderer";
import EdgeShader from "viewer/geometries/materials/edge_shader";
import NodeShader, {
  COLOR_TEXTURE_WIDTH,
  NodeTypes,
} from "viewer/geometries/materials/node_shader";
import { getZoomValue } from "viewer/model/accessors/flycam_accessor";
import { sum } from "viewer/model/helpers/iterator_utils";
import { cachedDiffTrees } from "viewer/model/sagas/skeletontracing_saga";
import type { CreateActionNode, UpdateActionNode } from "viewer/model/sagas/volume/update_actions";
import type { Edge, Node, Tree } from "viewer/model/types/tree_types";
import type { SkeletonTracing, WebknossosState } from "viewer/store";
import Store from "viewer/throttled_store";

const MAX_CAPACITY = 1000;

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
  treeColorTexture!: DataTexture;

  nodeShader: NodeShader | undefined;
  edgeShader: EdgeShader | undefined;

  // Is true while the buffers are filled in bulk (in which case no partial
  // update ranges should be tracked). See markChangedAttributes.
  private isBulkOperation: boolean = false;
  // Scratch buffer for partial uploads of the tree color texture.
  private treeColorTexelBuffer = new Float32Array(4);

  constructor(
    skeletonTracingSelectorFn: (state: WebknossosState) => SkeletonTracing | null,
    supportsPicking: boolean,
  ) {
    this.supportsPicking = supportsPicking;
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

    this.treeColorTexture.dispose();
    // @ts-expect-error
    this.treeColorTexture = undefined;

    this.nodes.material.dispose();
    this.edges.material.dispose();

    this.nodeShader?.destroy();
    this.edgeShader?.destroy();

    // Delete the actual GPU buffers. Otherwise, they would leak as three.js
    // only frees them on an explicit dispose() call.
    if (this.nodes != null) {
      for (const nodes of this.nodes.buffers) {
        nodes.geometry.dispose();
      }
    }

    if (this.edges != null) {
      for (const edges of this.edges.buffers) {
        edges.geometry.dispose();
      }
    }
  }

  reset(skeletonTracing: SkeletonTracing) {
    // Remove all existing geometries
    this.rootGroup.remove(...this.rootGroup.children);
    this.pickingNode.remove(...this.pickingNode.children);

    if (this.treeColorTexture != null) {
      this.treeColorTexture.dispose();
    }
    this.nodeShader?.destroy();
    this.edgeShader?.destroy();
    if (this.nodes != null) {
      this.nodes.material.dispose();
      for (const nodes of this.nodes.buffers) {
        nodes.geometry.dispose();
      }
    }
    if (this.edges != null) {
      this.edges.material.dispose();
      for (const edges of this.edges.buffers) {
        edges.geometry.dispose();
      }
    }

    const { trees } = skeletonTracing;

    const nodeCount = sum(trees.values().map((tree) => tree.nodes.size()));
    const edgeCount = sum(trees.values().map((tree) => tree.edges.size()));

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

    const flycamAdditionalCoordinateNames = new Set(
      (Store.getState().flycam.additionalCoordinates ?? []).map(({ name }) => name),
    );
    // fill buffers with data
    // Since the buffers were just created, they will be uploaded to the GPU
    // in full anyway. Tracking per-element update ranges would only waste
    // memory, which is why this is marked as a bulk operation.
    this.isBulkOperation = true;
    try {
      for (const tree of trees.values()) {
        this.createTree(tree, flycamAdditionalCoordinateNames);
      }
    } finally {
      this.isBulkOperation = false;
    }

    // compute bounding sphere to make ThreeJS happy
    for (const nodes of this.nodes.buffers) {
      nodes.geometry.computeBoundingSphere();
    }

    for (const edges of this.edges.buffers) {
      edges.geometry.computeBoundingSphere();
    }

    this.prevTracing = skeletonTracing;
  }

  initializeBufferCollection(
    initialCapacity: number,
    material: RawShaderMaterial,
    helper: BufferHelper,
  ): BufferCollection {
    const initialBuffer = this.initializeBuffer(
      Math.max(initialCapacity, MAX_CAPACITY),
      material,
      helper,
    );
    return {
      buffers: [initialBuffer],
      idToBufferPosition: new Map(),
      freeList: [],
      helper,
      material,
    };
  }

  initializeBuffer(capacity: number, material: RawShaderMaterial, helper: BufferHelper): Buffer {
    const geometry = new BufferGeometry() as BufferGeometryWithBufferAttributes;
    helper.initializeAttributes(geometry, capacity);
    const mesh = helper.buildMesh(geometry, material);
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
      currentBuffer = this.initializeBuffer(MAX_CAPACITY, collection.material, collection.helper);
      collection.buffers.unshift(currentBuffer);
    }

    const bufferPosition = collection.freeList.pop() || {
      buffer: currentBuffer,
      index: currentBuffer.nextIndex++,
    };
    collection.idToBufferPosition.set(id, bufferPosition);
    const changedAttributes = createFunc(bufferPosition);
    this.markChangedAttributes(bufferPosition, changedAttributes);
  }

  /**
   * Flags the changed attributes for upload to the GPU. Unless a bulk
   * operation is running, an update range covering only the changed
   * node/edge is registered so that three.js doesn't re-upload the whole
   * attribute array (which can be several MB for large tracings) on the
   * next render.
   */
  markChangedAttributes(bufferPosition: BufferPosition, changedAttributes: BufferAttribute[]) {
    const { buffer, index } = bufferPosition;

    for (const attribute of changedAttributes) {
      if (!this.isBulkOperation) {
        // Each node/edge occupies a fixed number of array elements
        // per attribute (e.g., 3 for a node's position, 6 for an edge's).
        const elementsPerEntry = attribute.array.length / buffer.capacity;
        attribute.addUpdateRange(index * elementsPerEntry, elementsPerEntry);
      }
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
      this.markChangedAttributes(bufferPosition, changedAttributes);

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
      this.markChangedAttributes(bufferPosition, changedAttributes);
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
          this.createNode(treeId, update.value, flycamAdditionalCoordinateNames);
          const tree = skeletonTracing.trees.getOrThrow(treeId);
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
          this.createEdge(tree.treeId, source, target, flycamAdditionalCoordinateNames);
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
          this.updateTreeColor(
            update.value.id,
            update.value.color,
            update.value.isVisible,
            update.value.edgesAreVisible,
          );
          break;
        }

        case "updateTreeVisibility":
        case "updateTreeEdgesVisibility": {
          const { treeId } = update.value;
          const tree = skeletonTracing.trees.getOrThrow(treeId);
          this.updateTreeColor(treeId, tree.color, tree.isVisible, tree.edgesAreVisible);
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

          if (tree.color !== prevTree.color) {
            this.updateTreeColor(treeId, update.value.color, tree.isVisible, tree.edgesAreVisible);
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
      // compute bounding sphere to make ThreeJS happy
      for (const nodes of this.nodes.buffers) {
        nodes.geometry.computeBoundingSphere();
      }

      for (const edges of this.edges.buffers) {
        edges.geometry.computeBoundingSphere();
      }
    }

    // Uniforms
    const { particleSize, overrideNodeRadius } = state.userConfiguration;
    let { activeNodeId } = skeletonTracing;
    activeNodeId = activeNodeId == null ? -1 : activeNodeId;

    let { activeTreeId } = skeletonTracing;
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
    this.prevTracing = skeletonTracing;
  }

  getAllNodes(): Object3D[] {
    return this.nodes.buffers.map((buffer) => buffer.mesh);
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
    for (const node of tree.nodes.values()) {
      this.createNode(tree.treeId, node, flycamAdditionalCoordinateNames);
    }

    for (const branchpoint of tree.branchPoints) {
      this.updateNodeType(tree.treeId, branchpoint.nodeId, NodeTypes.BRANCH_POINT);
    }

    for (const comment of tree.comments) {
      this.updateIsCommented(tree.treeId, comment.nodeId, true);
    }

    for (const edge of tree.edges.all()) {
      const source = tree.nodes.getOrThrow(edge.source);
      const target = tree.nodes.getOrThrow(edge.target);
      this.createEdge(tree.treeId, source, target, flycamAdditionalCoordinateNames);
    }

    this.updateTreeColor(tree.treeId, tree.color, tree.isVisible, tree.edgesAreVisible);
  }

  /**
   * Creates a new node in a WebGL buffer.
   */
  createNode(
    treeId: number,
    node: Node | UpdateActionNode | CreateActionNode,
    flycamAdditionalCoordinateNames: Set<string>,
  ) {
    const id = this.combineIds(node.id, treeId);
    this.create(id, this.nodes, ({ buffer, index }: BufferPosition): BufferAttribute[] => {
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
    this.delete(id, this.nodes, ({ buffer, index }) => {
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
    this.update(id, this.nodes, ({ buffer, index }) => {
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
    this.update(bufferNodeId, this.nodes, ({ buffer, index }) => {
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
      this.update(bufferEdgeId, this.edges, ({ buffer, index }) => {
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
    this.update(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.type;
      attribute.array[index] = type;
      return [attribute];
    });
  }

  updateIsCommented(treeId: number, nodeId: number, isCommented: boolean) {
    const id = this.combineIds(nodeId, treeId);
    this.update(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.isCommented;
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'boolean' is not assignable to type 'number'.
      attribute.array[index] = isCommented;
      return [attribute];
    });
  }

  /**
   * Creates a new edge in a WebGL buffer.
   */
  createEdge(
    treeId: number,
    source: Node,
    target: Node,
    flycamAdditionalCoordinateNames: Set<string>,
  ) {
    const id = this.combineIds(treeId, source.id, target.id);

    this.create(id, this.edges, ({ buffer, index }) => {
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
    this.delete(id, this.edges, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.position;
      attribute.set([0, 0, 0, 0, 0, 0], index * 6);
      return [attribute];
    });
  }

  /**
   * Updates a node/edge's color based on the tree color. Colors are stored in
   * a texture shared between the node and edge shader.
   */
  updateTreeColor(
    treeId: number,
    color: Vector3,
    isVisible: boolean = true,
    edgesAreVisible: boolean = true,
  ) {
    const rgba = this.getTreeRGBA(color, isVisible, edgesAreVisible);
    this.treeColorTexture.image.data.set(rgba, treeId * 4);

    if (!this.uploadTreeColorTexel(treeId, rgba)) {
      // Fall back to a full texture upload if a partial upload was not
      // possible (e.g., because the texture is not on the GPU yet, in which
      // case the full upload happens on initialization anyway).
      this.treeColorTexture.needsUpdate = true;
    }
  }

  /**
   * Uploads the changed texel of the tree color texture via texSubImage2D.
   * Otherwise, setting needsUpdate would re-upload the whole
   * COLOR_TEXTURE_WIDTH² RGBA-float texture (16.7 MB) on every tree
   * color/visibility change. Returns false if the partial upload could not
   * be performed.
   */
  uploadTreeColorTexel(treeId: number, rgba: Vector4): boolean {
    const renderer = getRenderer();
    if (typeof renderer.getContext !== "function") {
      // There is no real renderer (e.g., in headless tests).
      return false;
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const textureProperties = renderer.properties.get(this.treeColorTexture) as {
      __webglTexture: WebGLTexture | null | undefined;
    };
    if (textureProperties?.__webglTexture == null) {
      return false;
    }

    this.treeColorTexelBuffer.set(rgba);
    const activeTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.bindTexture(gl.TEXTURE_2D, textureProperties.__webglTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      treeId % COLOR_TEXTURE_WIDTH,
      Math.floor(treeId / COLOR_TEXTURE_WIDTH),
      1,
      1,
      gl.RGBA,
      gl.FLOAT,
      this.treeColorTexelBuffer,
    );
    gl.bindTexture(gl.TEXTURE_2D, activeTexture);
    return true;
  }

  getTreeRGBA(color: Vector3, isVisible: boolean, areEdgesVisible: boolean): Vector4 {
    const alpha = isVisible ? (areEdgesVisible ? 1 : 0.5) : 0;
    return [...color, alpha];
  }
}

export default Skeleton;
