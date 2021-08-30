/**
 * skeleton.js
 * @flow
 */

import * as THREE from "three";
import _ from "lodash";

import type { SkeletonTracing, Tree, Node, Edge } from "oxalis/store";
import type { Vector3, Vector4 } from "oxalis/constants";
import { cachedDiffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import { getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import { getSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import EdgeShader from "oxalis/geometries/materials/edge_shader";
import NodeShader, {
  NodeTypes,
  COLOR_TEXTURE_WIDTH,
} from "oxalis/geometries/materials/node_shader";
import Store from "oxalis/throttled_store";
import * as Utils from "libs/utils";

const MAX_CAPACITY = 1000;

// eslint-disable-next-line no-use-before-define
type BufferHelper = typeof NodeBufferHelperType | typeof EdgeBufferHelperType;

type Buffer = {
  capacity: number,
  nextIndex: number,
  geometry: typeof THREE.BufferGeometry,
  mesh: typeof THREE.Mesh,
};

type BufferPosition = {
  buffer: Buffer,
  index: number,
};

type BufferCollection = {
  buffers: Array<Buffer>,
  idToBufferPosition: Map<number, BufferPosition>,
  freeList: Array<BufferPosition>,
  helper: BufferHelper,
  material: typeof THREE.Material,
};

type BufferOperation = (position: BufferPosition) => Array<typeof THREE.BufferAttribute>;

const NodeBufferHelperType = {
  setAttributes(geometry: typeof THREE.BufferGeometry, capacity: number): void {
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute("radius", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("type", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("isCommented", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("nodeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
  },

  buildMesh(
    geometry: typeof THREE.BufferGeometry,
    material: typeof THREE.RawShaderMaterial,
  ): typeof THREE.Mesh {
    return new THREE.Points(geometry, material);
  },

  supportsPicking: true,
};

const EdgeBufferHelperType = {
  setAttributes(geometry: typeof THREE.BufferGeometry, capacity: number): void {
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 6), 3));
    geometry.setAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity * 2), 1));
  },

  buildMesh(
    geometry: typeof THREE.BufferGeometry,
    material: typeof THREE.LineBasicMaterial,
  ): typeof THREE.Mesh {
    return new THREE.LineSegments(geometry, material);
  },

  supportsPicking: false,
};

/**
 * Creates and manages the WebGL buffers for drawing skeletons (nodes, edges).
 * Skeletons are not recreated on every store change in spite of the functional
 * react paradigm for performance reasons. Instead we identify more fine granular
 * actions like node cration/deletion/update etc.
 * Skeletons are stored in single, large buffers regardless of which tree they belong to.
 * Nodes are never deleted but marked as type "INVALID" and not drawn by the shader.
 * @class
 */
class Skeleton {
  rootGroup: typeof THREE.Group;
  pickingNode: typeof THREE.Object3D;
  prevTracing: SkeletonTracing;
  nodes: BufferCollection;
  edges: BufferCollection;
  treeColorTexture: typeof THREE.DataTexture;

  constructor() {
    this.rootGroup = new THREE.Group();
    this.pickingNode = new THREE.Object3D();

    getSkeletonTracing(Store.getState().tracing).map(skeletonTracing => {
      this.reset(skeletonTracing);
    });

    Store.subscribe(() => {
      getSkeletonTracing(Store.getState().tracing).map(skeletonTracing => {
        if (skeletonTracing.tracingId !== this.prevTracing.tracingId) {
          this.reset(skeletonTracing);
        } else {
          this.refresh(skeletonTracing);
        }
      });
    });
  }

  reset(skeletonTracing: SkeletonTracing) {
    // Remove all existing geometries
    this.rootGroup.remove(...this.rootGroup.children);
    this.pickingNode.remove(...this.pickingNode.children);

    const { trees } = skeletonTracing;
    const nodeCount = _.sum(_.map(trees, tree => tree.nodes.size()));
    const edgeCount = _.sum(_.map(trees, tree => tree.edges.size()));

    this.treeColorTexture = new THREE.DataTexture(
      new Float32Array(COLOR_TEXTURE_WIDTH * COLOR_TEXTURE_WIDTH * 4),
      COLOR_TEXTURE_WIDTH,
      COLOR_TEXTURE_WIDTH,
      THREE.RGBAFormat,
      THREE.FloatType,
    );

    const nodeMaterial = new NodeShader(this.treeColorTexture).getMaterial();
    const edgeMaterial = new EdgeShader(this.treeColorTexture).getMaterial();

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
    this.nodes = this.initializeBufferCollection(nodeCount, nodeMaterial, NodeBufferHelperType);
    this.edges = this.initializeBufferCollection(edgeCount, edgeMaterial, EdgeBufferHelperType);

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
    material: typeof THREE.Material,
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
    material: typeof THREE.Material,
    helper: BufferHelper,
  ): Buffer {
    const geometry = new THREE.BufferGeometry();
    helper.setAttributes(geometry, capacity);
    const mesh = helper.buildMesh(geometry, material);
    this.rootGroup.add(mesh);
    if (helper.supportsPicking) {
      const pickingMesh = helper.buildMesh(geometry, material);
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
   * @param updateBoundingSphere - toggle to update ThreeJS's internals
   * @param createFunc - callback(buffer, index) that actually creates a node / edge
   */
  create(id: number, collection: BufferCollection, createFunc: BufferOperation) {
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
  delete(id: number, collection: BufferCollection, deleteFunc: BufferOperation) {
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
   * @param deleteFunc - callback(buffer, index) that actually updates a node / edge
   */
  update(id: number, collection: BufferCollection, updateFunc: BufferOperation) {
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
   * @param id - Id of a node or edge to look up its corresponding buffer
   * @param collection - collection of all buffers
   * @param deleteFunc - callback(buffer, index) that actually updates a node / edge
   */
  refresh(skeletonTracing: SkeletonTracing) {
    const state = Store.getState();
    const diff = cachedDiffTrees(this.prevTracing, skeletonTracing);

    for (const update of diff) {
      switch (update.name) {
        case "createNode": {
          const { treeId, id: nodeId } = update.value;
          this.createNode(treeId, update.value);
          const tree = skeletonTracing.trees[treeId];
          const isBranchpoint = tree.branchPoints.find(bp => bp.nodeId === nodeId) != null;
          if (isBranchpoint) {
            this.updateNodeType(treeId, nodeId, NodeTypes.BRANCH_POINT);
          }
          const isCommented = tree.comments.find(bp => bp.nodeId === nodeId) != null;
          if (isCommented) {
            this.updateIsCommented(treeId, nodeId, true);
          }

          break;
        }
        case "deleteNode":
          this.deleteNode(update.value.treeId, update.value.nodeId);
          break;
        case "createEdge": {
          const tree = skeletonTracing.trees[update.value.treeId];
          const source = tree.nodes.get(update.value.source);
          const target = tree.nodes.get(update.value.target);
          this.createEdge(tree.treeId, source, target);
          break;
        }
        case "deleteEdge":
          this.deleteEdge(update.value.treeId, update.value.source, update.value.target);
          break;
        case "updateNode": {
          const { treeId, id, radius, position } = update.value;
          this.updateNodeRadius(treeId, id, radius);
          const tree = skeletonTracing.trees[treeId];
          this.updateNodePosition(tree, id, position);
          break;
        }
        case "createTree":
          this.updateTreeColor(update.value.id, update.value.color, update.value.isVisible);
          break;
        case "updateTreeVisibility": {
          const { treeId } = update.value;
          const tree = skeletonTracing.trees[treeId];
          this.updateTreeColor(treeId, tree.color, tree.isVisible);
          break;
        }
        case "updateTree": {
          // Helper function to act on created or deleted elements
          const forEachCreatedOrDeletedId = <T: { +nodeId: number }>(
            oldElements: Array<T>,
            newElements: Array<T>,
            callback: (number, boolean) => void,
          ) => {
            const oldIds = oldElements.map(el => el.nodeId);
            const newIds = newElements.map(el => el.nodeId);
            const { onlyA: deletedIds, onlyB: createdIds } = Utils.diffArrays(oldIds, newIds);
            createdIds.forEach(id => callback(id, true));
            deletedIds.forEach(id => callback(id, false));
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
            this.updateTreeColor(treeId, update.value.color, tree.isVisible);
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

  getAllNodes(): Array<typeof THREE.Mesh> {
    return this.nodes.buffers.map(buffer => buffer.mesh);
  }

  getRootGroup(): typeof THREE.Object3D {
    return this.rootGroup;
  }

  startPicking(isTouch: boolean): typeof THREE.Object3D {
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
   * Combined node/edge id and a treeId to a single unique id using recursive cantor pairings.
   * @param numbers - Array of node/edge id and treeId
   */
  combineIds(...numbers: Array<number>) {
    return numbers.reduce((acc, value) => 0.5 * (acc + value) * (acc + value + 1) + value);
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
      const source = tree.nodes.get(edge.source);
      const target = tree.nodes.get(edge.target);
      this.createEdge(tree.treeId, source, target);
    }

    this.updateTreeColor(tree.treeId, tree.color, tree.isVisible);
  }

  /**
   * Creates a new node in a WebGL buffer.
   */
  createNode(treeId: number, node: Node) {
    const id = this.combineIds(node.id, treeId);
    this.create(id, this.nodes, ({ buffer, index }) => {
      const { attributes } = buffer.geometry;
      attributes.position.set(node.position, index * 3);
      attributes.radius.array[index] = node.radius;
      attributes.type.array[index] = NodeTypes.NORMAL;
      attributes.isCommented.array[index] = false;
      attributes.nodeId.array[index] = node.id;
      attributes.treeId.array[index] = treeId;
      return _.values(attributes);
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
  updateNodePosition(tree: Tree, nodeId: number, position: Vector3) {
    const { treeId } = tree;
    const bufferNodeId = this.combineIds(nodeId, treeId);
    this.update(bufferNodeId, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.position;
      attribute.set(position, index * 3);
      return [attribute];
    });

    const edgePositionUpdater = (edge: Edge, isIngoingEdge: boolean) => {
      // The changed node is the target node of the edge which is saved
      // after the source node in the buffer. THus we need an offset.
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
      attribute.array[index] = type;
      return [attribute];
    });
  }

  updateIsCommented(treeId: number, nodeId: number, isCommented: boolean) {
    const id = this.combineIds(nodeId, treeId);
    this.update(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.isCommented;
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
      const positionAttribute = buffer.geometry.attributes.position;
      const treeIdAttribute = buffer.geometry.attributes.treeId;

      positionAttribute.set(source.position, index * 6);
      positionAttribute.set(target.position, index * 6 + 3);
      treeIdAttribute.set([treeId, treeId], index * 2);
      return [positionAttribute, treeIdAttribute];
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
   * Updates a node/edges's color based on the tree color. Colors are stored in
   * a texture shared between the node and edge shader.
   */
  updateTreeColor(treeId: number, color: Vector3, isVisible: boolean = true) {
    const rgba = this.getTreeRGBA(color, isVisible);
    this.treeColorTexture.image.data.set(rgba, treeId * 4);
    this.treeColorTexture.needsUpdate = true;
  }

  getTreeRGBA(color: Vector3, isVisible: boolean): Vector4 {
    return [...color, isVisible ? 1 : 0];
  }
}

export default Skeleton;
