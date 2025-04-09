import type Maybe from "data.maybe";
import * as Utils from "libs/utils";
import _ from "lodash";
import type { Vector3, Vector4 } from "oxalis/constants";
import EdgeShader from "oxalis/geometries/materials/edge_shader";
import NodeShader, {
  NodeTypes,
  COLOR_TEXTURE_WIDTH,
} from "oxalis/geometries/materials/node_shader";
import { getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import { cachedDiffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import type { CreateActionNode, UpdateActionNode } from "oxalis/model/sagas/update_actions";
import type { Edge, Node, OxalisState, SkeletonTracing, Tree } from "oxalis/store";
import Store from "oxalis/throttled_store";
import * as THREE from "three";
import type { AdditionalCoordinate } from "types/api_flow_types";

const MAX_CAPACITY = 1000;

type BufferGeometryWithBufferAttributes = THREE.BufferGeometry & {
  attributes: Record<string, THREE.BufferAttribute>;
};

type BufferHelper = typeof NodeBufferHelperType | typeof EdgeBufferHelperType;
type Buffer = {
  capacity: number;
  nextIndex: number;
  geometry: BufferGeometryWithBufferAttributes;
  mesh: THREE.Object3D;
};
type BufferPosition = {
  buffer: Buffer;
  index: number;
};
type BufferCollection = {
  buffers: Array<Buffer>;
  idToBufferPosition: Map<string, BufferPosition>;
  freeList: Array<BufferPosition>;
  helper: BufferHelper;
  material: THREE.RawShaderMaterial;
};

type BufferOperation = (position: BufferPosition) => Array<THREE.BufferAttribute>;
const NodeBufferHelperType = {
  setAttributes(geometry: THREE.BufferGeometry, capacity: number): void {
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));

    const additionalCoordLength = (Store.getState().flycam.additionalCoordinates ?? []).length;
    for (const idx of _.range(0, additionalCoordLength)) {
      geometry.setAttribute(
        `additionalCoord_${idx}`,
        new THREE.BufferAttribute(new Float32Array(capacity), 1),
      );
    }
    geometry.setAttribute("radius", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("type", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("isCommented", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("nodeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
  },

  buildMesh(geometry: THREE.BufferGeometry, material: THREE.RawShaderMaterial): THREE.Object3D {
    return new THREE.Points(geometry, material);
  },

  supportsPicking: true,
};

const EdgeBufferHelperType = {
  setAttributes(geometry: THREE.BufferGeometry, capacity: number): void {
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(capacity * 2 * 3), 3),
    );

    const additionalCoordLength = (Store.getState().flycam.additionalCoordinates ?? []).length;
    for (const idx of _.range(0, additionalCoordLength)) {
      geometry.setAttribute(
        `additionalCoord_${idx}`,
        new THREE.BufferAttribute(new Float32Array(capacity * 2), 1),
      );
    }

    geometry.setAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity * 2), 1));
  },

  buildMesh(geometry: THREE.BufferGeometry, material: THREE.RawShaderMaterial): THREE.Object3D {
    return new THREE.LineSegments(geometry, material);
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
  rootGroup: THREE.Group;
  pickingNode: THREE.Object3D;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'prevTracing' has no initializer and is n... Remove this comment to see the full error message
  prevTracing: SkeletonTracing;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'nodes' has no initializer and is not def... Remove this comment to see the full error message
  nodes: BufferCollection;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'edges' has no initializer and is not def... Remove this comment to see the full error message
  edges: BufferCollection;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'treeColorTexture' has no initializer and... Remove this comment to see the full error message
  treeColorTexture: THREE.DataTexture;
  supportsPicking: boolean;
  stopStoreListening: () => void;

  nodeShader: NodeShader | undefined;
  edgeShader: EdgeShader | undefined;

  constructor(
    skeletonTracingSelectorFn: (state: OxalisState) => Maybe<SkeletonTracing>,
    supportsPicking: boolean,
  ) {
    this.supportsPicking = supportsPicking;
    this.rootGroup = new THREE.Group();
    this.pickingNode = new THREE.Object3D();
    skeletonTracingSelectorFn(Store.getState()).map((skeletonTracing) => {
      this.reset(skeletonTracing);
    });
    this.stopStoreListening = Store.subscribe(() => {
      skeletonTracingSelectorFn(Store.getState()).map((skeletonTracing) => {
        if (skeletonTracing.tracingId !== this.prevTracing.tracingId) {
          this.reset(skeletonTracing);
        } else {
          this.refresh(skeletonTracing);
        }
      });
    });
  }

  destroy() {
    this.stopStoreListening();
    this.stopStoreListening = () => {};

    this.treeColorTexture.dispose();
    // @ts-ignore
    this.treeColorTexture = undefined;

    this.nodes.material.dispose();
    this.edges.material.dispose();

    this.nodeShader?.destroy();
    this.edgeShader?.destroy();
  }

  reset(skeletonTracing: SkeletonTracing) {
    // Remove all existing geometries
    this.rootGroup.remove(...this.rootGroup.children);
    this.pickingNode.remove(...this.pickingNode.children);
    const { trees } = skeletonTracing;

    const nodeCount = _.sum(_.map(trees, (tree) => tree.nodes.size()));

    const edgeCount = _.sum(_.map(trees, (tree) => tree.edges.size()));

    this.treeColorTexture = new THREE.DataTexture(
      new Float32Array(COLOR_TEXTURE_WIDTH * COLOR_TEXTURE_WIDTH * 4),
      COLOR_TEXTURE_WIDTH,
      COLOR_TEXTURE_WIDTH,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.nodeShader = new NodeShader(this.treeColorTexture);
    this.edgeShader = new EdgeShader(this.treeColorTexture);

    // delete actual GPU buffers in case there were any
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

    // fill buffers with data
    for (const tree of _.values(trees)) {
      this.createTree(tree);
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
    material: THREE.RawShaderMaterial,
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

  initializeBuffer(
    capacity: number,
    material: THREE.RawShaderMaterial,
    helper: BufferHelper,
  ): Buffer {
    const geometry = new THREE.BufferGeometry() as BufferGeometryWithBufferAttributes;
    helper.setAttributes(geometry, capacity);
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
    );

    for (const update of diff) {
      switch (update.name) {
        case "createNode": {
          const { treeId, id: nodeId } = update.value;
          this.createNode(treeId, update.value);
          const tree = skeletonTracing.trees[treeId];
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
          const tree = skeletonTracing.trees[update.value.treeId];
          const source = tree.nodes.getOrThrow(update.value.source);
          const target = tree.nodes.getOrThrow(update.value.target);
          this.createEdge(tree.treeId, source, target);
          break;
        }

        case "deleteEdge": {
          this.deleteEdge(update.value.treeId, update.value.source, update.value.target);
          break;
        }

        case "updateNode": {
          const { treeId, id, radius, position, additionalCoordinates } = update.value;
          this.updateNodeRadius(treeId, id, radius);
          const tree = skeletonTracing.trees[treeId];
          this.updateNodePosition(tree, id, position, additionalCoordinates);
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
          const tree = skeletonTracing.trees[treeId];
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
            const { onlyA: deletedIds, onlyB: createdIds } = Utils.diffArrays(oldIds, newIds);
            createdIds.forEach((id) => callback(id, true));
            deletedIds.forEach((id) => callback(id, false));
          };

          const treeId = update.value.id;
          const tree = skeletonTracing.trees[treeId];
          const prevTree = this.prevTracing.trees[treeId];
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

  getAllNodes(): Array<THREE.Object3D> {
    return this.nodes.buffers.map((buffer) => buffer.mesh);
  }

  getRootGroup(): THREE.Object3D {
    return this.rootGroup;
  }

  startPicking(isTouch: boolean): THREE.Object3D {
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
  combineIds(...numbers: Array<number>): string {
    return numbers.join(",");
  }

  /**
   * Utility function to create a complete tree.
   * Usually called only once initially.
   */
  createTree(tree: Tree) {
    for (const node of tree.nodes.values()) {
      this.createNode(tree.treeId, node);
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
      this.createEdge(tree.treeId, source, target);
    }

    this.updateTreeColor(tree.treeId, tree.color, tree.isVisible, tree.edgesAreVisible);
  }

  /**
   * Creates a new node in a WebGL buffer.
   */
  createNode(treeId: number, node: Node | UpdateActionNode | CreateActionNode) {
    const id = this.combineIds(node.id, treeId);
    this.create(
      id,
      this.nodes,
      ({ buffer, index }: BufferPosition): Array<THREE.BufferAttribute> => {
        const attributes = buffer.geometry.attributes;
        const untransformedPosition =
          "untransformedPosition" in node ? node.untransformedPosition : node.position;
        attributes.position.set(untransformedPosition, index * 3);

        if (node.additionalCoordinates) {
          for (const idx of _.range(0, node.additionalCoordinates.length)) {
            const attributeAdditionalCoordinates =
              buffer.geometry.attributes[`additionalCoord_${idx}`];
            attributeAdditionalCoordinates.set([node.additionalCoordinates[idx].value], index);
          }
        }
        // @ts-expect-error ts-migrate(2542) FIXME: Index signature in type 'any[] | ArrayLike<number>... Remove this comment to see the full error message
        attributes.radius.array[index] = node.radius;
        // @ts-expect-error ts-migrate(2542) FIXME: Index signature in type 'any[] | ArrayLike<number>... Remove this comment to see the full error message
        attributes.type.array[index] = NodeTypes.NORMAL;
        // @ts-expect-error ts-migrate(2542) FIXME: Index signature in type 'any[] | ArrayLike<number>... Remove this comment to see the full error message
        attributes.isCommented.array[index] = false;
        // @ts-expect-error ts-migrate(2542) FIXME: Index signature in type 'any[] | ArrayLike<number>... Remove this comment to see the full error message
        attributes.nodeId.array[index] = node.id;
        // @ts-expect-error ts-migrate(2542) FIXME: Index signature in type 'any[] | ArrayLike<number>... Remove this comment to see the full error message
        attributes.treeId.array[index] = treeId;
        return _.values(attributes);
      },
    );
  }

  /**
   * Delete/invalidates a node in a WebGL buffer.
   */
  deleteNode(treeId: number, nodeId: number) {
    const id = this.combineIds(nodeId, treeId);
    this.delete(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.type;
      // @ts-expect-error ts-migrate(2542) FIXME: Index signature in type 'ArrayLike<number>' only p... Remove this comment to see the full error message
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
      // @ts-expect-error ts-migrate(2542) FIXME: Index signature in type 'ArrayLike<number>' only p... Remove this comment to see the full error message
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
  ) {
    const { treeId } = tree;
    const bufferNodeId = this.combineIds(nodeId, treeId);
    this.update(bufferNodeId, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.position;
      attribute.set(position, index * 3);

      if (additionalCoordinates) {
        for (const idx of _.range(0, additionalCoordinates.length)) {
          const attributeAdditionalCoordinates =
            buffer.geometry.attributes[`additionalCoord_${idx}`];
          attributeAdditionalCoordinates.set([additionalCoordinates[idx].value], index);
        }
      }

      return [attribute];
    });

    const edgePositionUpdater = (edge: Edge, isIngoingEdge: boolean) => {
      // The changed node is the target node of the edge which is saved
      // after the source node in the buffer. Thus we need an offset.
      const indexOffset = isIngoingEdge ? 3 : 0;
      const bufferEdgeId = this.combineIds(treeId, edge.source, edge.target);
      this.update(bufferEdgeId, this.edges, ({ buffer, index }) => {
        const positionAttribute = buffer.geometry.attributes.position;
        positionAttribute.set(position, index * 6 + indexOffset);
        return [positionAttribute];
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
      // @ts-expect-error ts-migrate(2542) FIXME: Index signature in type 'ArrayLike<number>' only p... Remove this comment to see the full error message
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
  createEdge(treeId: number, source: Node, target: Node) {
    const id = this.combineIds(treeId, source.id, target.id);
    this.create(id, this.edges, ({ buffer, index }) => {
      const { attributes } = buffer.geometry;
      const positionAttribute = attributes.position;
      const treeIdAttribute = attributes.treeId;

      positionAttribute.set(source.untransformedPosition, index * 6);
      positionAttribute.set(target.untransformedPosition, index * 6 + 3);
      treeIdAttribute.set([treeId, treeId], index * 2);

      const changedAttributes = [];
      if (source.additionalCoordinates && target.additionalCoordinates) {
        for (const idx of _.range(0, source.additionalCoordinates.length)) {
          const additionalCoordAttribute = attributes[`additionalCoord_${idx}`];

          additionalCoordAttribute.set([source.additionalCoordinates[idx].value], 2 * index);
          additionalCoordAttribute.set([target.additionalCoordinates[idx].value], 2 * index + 1);
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
    this.treeColorTexture.needsUpdate = true;
  }

  getTreeRGBA(color: Vector3, isVisible: boolean, areEdgesVisible: boolean): Vector4 {
    const alpha = isVisible ? (areEdgesVisible ? 1 : 0.5) : 0;
    return [...color, alpha];
  }
}

export default Skeleton;
