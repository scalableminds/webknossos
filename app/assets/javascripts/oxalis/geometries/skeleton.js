/**
 * skeleton.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import TWEEN from "tween.js";
import Utils from "libs/utils";
import Store from "oxalis/throttled_store";
import { diffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import NodeShader, { NodeTypes, COLOR_TEXTURE_WIDTH } from "oxalis/geometries/materials/node_shader";
import EdgeShader from "oxalis/geometries/materials/edge_shader";
import { OrthoViews } from "oxalis/constants";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import type { SkeletonTracingType, TreeType, NodeType } from "oxalis/store";
import type { Vector3, OrthoViewType } from "oxalis/constants";


const MAX_CAPACITY = 1000;

// eslint-disable-next-line no-use-before-define
type BufferHelperType = typeof NodeBufferHelperType | typeof EdgeBufferHelperType;

type Buffer = {
  capacity: number,
  nextIndex: number,
  geometry: THREE.BufferGeometry,
  mesh: THREE.Mesh,
}

type BufferPosition = {
  buffer: Buffer,
  index: number,
}

type BufferCollection = {
  buffers: Array<Buffer>,
  idToBufferPosition: Map<number, BufferPosition>,
  freeList: Array<BufferPosition>,
  helper: BufferHelperType,
  material: THREE.Material,
}

type BufferOperation = (position: BufferPosition) => Array<THREE.BufferAttribute>;

const NodeBufferHelperType = {
  addAttributes(geometry: THREE.BufferGeometry, capacity: number): void {
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.addAttribute("radius", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("type", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("nodeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
  },

  buildMesh(geometry: THREE.BufferGeometry, material: THREE.RawShaderMaterial): THREE.Mesh {
    return new THREE.Points(geometry, material);
  },

  supportsPicking: true,
};

const EdgeBufferHelperType = {
  addAttributes(geometry: THREE.BufferGeometry, capacity: number): void {
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 6), 3));
    geometry.addAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity * 2), 1));
  },

  buildMesh(geometry: THREE.BufferGeometry, material: THREE.LineBasicMaterial): THREE.Mesh {
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
  rootNode: THREE.Object3D;
  pickingNode: THREE.Object3D;
  prevTracing: SkeletonTracingType;
  nodes: BufferCollection;
  edges: BufferCollection;
  treeColorTexture: THREE.DataTexture;

  constructor() {
    this.rootNode = new THREE.Object3D();
    this.pickingNode = new THREE.Object3D();

    const state = Store.getState();
    const trees = state.skeletonTracing.trees;
    const nodeCount = _.sum(_.map(trees, tree => _.size(tree.nodes)));
    const edgeCount = _.sum(_.map(trees, tree => _.size(tree.edges)));

    this.treeColorTexture = new THREE.DataTexture(
      new Float32Array(COLOR_TEXTURE_WIDTH * COLOR_TEXTURE_WIDTH * 3),
      COLOR_TEXTURE_WIDTH,
      COLOR_TEXTURE_WIDTH,
      THREE.RGBFormat,
      THREE.FloatType,
    );

    const nodeMaterial = new NodeShader(this.treeColorTexture).getMaterial();
    const edgeMaterial = new EdgeShader(this.treeColorTexture).getMaterial();

    this.nodes = this.initializeBufferCollection(nodeCount, nodeMaterial, NodeBufferHelperType);
    this.edges = this.initializeBufferCollection(edgeCount, edgeMaterial, EdgeBufferHelperType);

    for (const tree of _.values(trees)) {
      this.createTree(tree);
    }
    for (const nodes of this.nodes.buffers) {
      nodes.geometry.computeBoundingSphere();
    }
    for (const edges of this.edges.buffers) {
      edges.geometry.computeBoundingSphere();
    }

    Store.subscribe(() => this.refresh());
    this.prevTracing = Store.getState().skeletonTracing;
  }

  initializeBufferCollection(initialCapacity: number, material: THREE.Material, helper: BufferHelperType): BufferCollection {
    const initialBuffer = this.initializeBuffer(Math.max(initialCapacity, MAX_CAPACITY), material, helper);

    return {
      buffers: [initialBuffer],
      idToBufferPosition: new Map(),
      freeList: [],
      helper,
      material,
    };
  }

  initializeBuffer(capacity: number, material: THREE.Material, helper: BufferHelperType): Buffer {
    const geometry = new THREE.BufferGeometry();
    helper.addAttributes(geometry, capacity);
    const mesh = helper.buildMesh(geometry, material);
    this.rootNode.add(mesh);
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
  create(id: number, collection: BufferCollection, updateBoundingSphere: boolean, createFunc: BufferOperation) {
    let currentBuffer = collection.buffers[0];
    if (collection.freeList.length === 0 && currentBuffer.nextIndex >= currentBuffer.capacity) {
      currentBuffer = this.initializeBuffer(MAX_CAPACITY, collection.material, collection.helper);
      collection.buffers.unshift(currentBuffer);
    }
    const bufferPosition = collection.freeList.pop() || { buffer: currentBuffer, index: currentBuffer.nextIndex++ };
    collection.idToBufferPosition.set(id, bufferPosition);

    const changedAttributes = createFunc(bufferPosition);
    for (const attribute of changedAttributes) {
      attribute.needsUpdate = true;
    }

    if (updateBoundingSphere) {
      // Needs to be done to make ThreeJS happy
      // Option is disable for the very first buffers created on skeleton initialization for performance
      bufferPosition.buffer.geometry.computeBoundingSphere();
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
  refresh() {
    const state = Store.getState();
    const tracing = state.skeletonTracing;
    const diff = diffTrees(this.prevTracing.trees, tracing.trees);

    for (const update of diff) {
      switch (update.action) {
        case "createNode": {
          this.createNode(update.value.treeId, update.value);
          break;
        }
        case "deleteNode":
          this.deleteNode(update.value.treeId, update.value.id);
          break;
        case "createEdge": {
          const tree = tracing.trees[update.value.treeId];
          const source = tree.nodes[update.value.source];
          const target = tree.nodes[update.value.target];
          this.createEdge(tree.treeId, source, target);
          break;
        }
        case "deleteEdge":
          this.deleteEdge(update.value.treeId, update.value.source, update.value.target);
          break;
        case "updateNode":
          this.updateNodeRadius(update.value.treeId, update.value.id, update.value.radius);
          break;
        case "createTree":
          this.updateTreeColor(update.value.id, update.value.color);
          break;
        case "updateTree": {
          // diff branchpoints
          const treeId = update.value.id;
          const tree = tracing.trees[treeId];
          const prevTree = this.prevTracing.trees[treeId];
          const oldBranchPoints = prevTree.branchPoints.map(branchPoint => branchPoint.id);
          const newBranchPoints = tree.branchPoints.map(branchPoint => branchPoint.id);
          const { onlyA: deletedBranchPoints, onlyB: createdBranchPoints } = Utils.diffArrays(oldBranchPoints, newBranchPoints);

          for (const nodeId of deletedBranchPoints) {
            this.updateNodeType(treeId, nodeId, NodeTypes.NORMAL);
          }

          for (const nodeId of createdBranchPoints) {
            this.updateNodeType(treeId, nodeId, NodeTypes.BRANCH_POINT);
          }

          if (tree.color !== prevTree.color) {
            this.updateTreeColor(treeId, update.value.color);
          }
          break;
        }
        case "deleteTree":
        case "moveTreeComponent":
        case "mergeTree":
          // Unused for now
          break;
        default:
          throw new Error("[Skeleton] Unhandled skeletontracing diff action");
      }
    }

    if (tracing.activeNodeId !== this.prevTracing.activeNodeId) {
      this.startNodeHighlightAnimation();
    }

    // Uniforms
    const { particleSize, scale, overrideNodeRadius } = state.userConfiguration;
    let activeNodeId = state.skeletonTracing.activeNodeId;
    activeNodeId = activeNodeId == null ? -1 : activeNodeId;
    let activeTreeId = state.skeletonTracing.activeTreeId;
    activeTreeId = activeTreeId == null ? -1 : activeTreeId;

    const nodeUniforms = this.nodes.material.uniforms;
    nodeUniforms.planeZoomFactor.value = getPlaneScalingFactor(state.flycam);
    nodeUniforms.overrideParticleSize.value = particleSize;
    nodeUniforms.overrideNodeRadius.value = overrideNodeRadius;
    nodeUniforms.viewportScale.value = scale;
    nodeUniforms.activeTreeId.value = activeTreeId;
    nodeUniforms.activeNodeId.value = activeNodeId;
    nodeUniforms.shouldHideInactiveTrees.value = state.temporaryConfiguration.shouldHideInactiveTrees;
    nodeUniforms.shouldHideAllSkeletons.value = state.temporaryConfiguration.shouldHideAllSkeletons;

    const edgeUniforms = this.edges.material.uniforms;
    edgeUniforms.activeTreeId.value = activeTreeId;
    edgeUniforms.shouldHideInactiveTrees.value = state.temporaryConfiguration.shouldHideInactiveTrees;
    edgeUniforms.shouldHideAllSkeletons.value = state.temporaryConfiguration.shouldHideAllSkeletons;
    this.edges.material.linewidth = state.userConfiguration.particleSize / 4;

    this.prevTracing = tracing;
  }

  getAllNodes(): Array<THREE.Mesh> {
    return this.nodes.buffers.map(buffer => buffer.mesh);
  }

  getRootNode(): THREE.Object3D {
    return this.rootNode;
  }

  startPicking(): THREE.Object3D {
    this.pickingNode.matrixAutoUpdate = false;
    this.pickingNode.matrix.copy(this.rootNode.matrixWorld);
    this.nodes.material.uniforms.isPicking.value = 1;
    return this.pickingNode;
  }

  stopPicking(): void {
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
  createTree(tree: TreeType) {
    for (const node of _.values(tree.nodes)) {
      this.createNode(tree.treeId, node, false);
    }
    for (const branchpoint of tree.branchPoints) {
      this.updateNodeType(tree.treeId, branchpoint.id, NodeTypes.BRANCH_POINT);
    }
    for (const edge of tree.edges) {
      const source = tree.nodes[edge.source];
      const target = tree.nodes[edge.target];
      this.createEdge(tree.treeId, source, target, false);
    }

    this.updateTreeColor(tree.treeId, tree.color);
  }

  /**
   * Creates a new node in a WebGL buffer.
   */
  createNode(treeId: number, node: NodeType, updateBoundingSphere: boolean = true) {
    const id = this.combineIds(node.id, treeId);
    this.create(id, this.nodes, updateBoundingSphere, ({ buffer, index }) => {
      const attributes = buffer.geometry.attributes;
      attributes.position.set(node.position, index * 3);
      attributes.radius.array[index] = node.radius;
      attributes.type.array[index] = NodeTypes.NORMAL;
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

  /**
   * Creates a new edge in a WebGL buffer.
   */
  createEdge(treeId: number, source: NodeType, target: NodeType, updateBoundingSphere: boolean = true) {
    const id = this.combineIds(treeId, source.id, target.id);
    this.create(id, this.edges, updateBoundingSphere, ({ buffer, index }) => {
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
  updateTreeColor(treeId: number, color: Vector3) {
    this.treeColorTexture.image.data.set(color, treeId * 3);
    this.treeColorTexture.needsUpdate = true;
  }

  /**
   * Updates shader uniforms depending on which of the four tracing viewports is rendered.
   */
  updateForCam(camera: OrthoViewType) {
    const is3DView = camera === OrthoViews.TDView;

    this.nodes.material.uniforms.is3DView.value = is3DView;
    this.edges.material.uniforms.is3DView.value = is3DView;
  }

  /**
   * Calculates a resizing factor for the active node's radius every time the
   * active node id changes. In essence this animates the node's radius to grow/shrink a little.
   */
  async startNodeHighlightAnimation() {
    const normal = 1.0;
    const highlighted = 2.0;

    await this.animateNodeScale(normal, highlighted);
    await this.animateNodeScale(highlighted, normal);
  }

  /**
   * Calculates a resizing factor for the active node's radius every time the
   * active node id changes. In essence this animates the node's radius to grow/shrink a little.
   */
  animateNodeScale(from: number, to: number) {
    return new Promise((resolve, reject) => {
      const setScaleFactor = (scale) => {
        this.nodes.material.uniforms.activeNodeScaleFactor.value = scale;
      };

      const tweenAnimation = new TWEEN.Tween({ scaleFactor: from });
      tweenAnimation
      .to({ scaleFactor: to }, 100)
      .onUpdate(function onUpdate() {
        setScaleFactor(this.scaleFactor);
      })
      .onComplete(resolve)
      .onStop(reject)
      .start();
    });
  }
}

export default Skeleton;
