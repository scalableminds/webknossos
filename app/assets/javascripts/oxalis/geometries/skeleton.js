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
import NodeShader, { NodeTypes } from "oxalis/geometries/materials/node_shader";
import EdgeShader from "oxalis/geometries/materials/edge_shader";
import { OrthoViews, OrthoViewType } from "oxalis/constants";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import type { SkeletonTracingType, TreeType, NodeType } from "oxalis/store";
import type { Vector3 } from "oxalis/constants";


const MAX_CAPACITY = 1000;

type BufferHelper = {
  addAttributes(geometry: THREE.BufferGeometry, capacity: number): void,
  buildMesh(geometry: THREE.BufferGeometry): THREE.Mesh,
}

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
  helper: BufferHelper,
  material: THREE.Material,
}

type BufferOperation = (position: BufferPosition) => Array<THREE.BufferAttribute>;

const NodeBufferHelper = {
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
};

const EdgeBufferHelper = {
  addAttributes(geometry: THREE.BufferGeometry, capacity: number): void {
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 6), 3));
    geometry.addAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity * 2), 1));
  },

  buildMesh(geometry: THREE.BufferGeometry, material: THREE.LineBasicMaterial): THREE.Mesh {
    return new THREE.LineSegments(geometry, material);
  },
};

class Skeleton {
  // This class is supposed to collect all the Geometries that belong to the skeleton, like
  // nodes, edges and trees

  rootNode: THREE.Object3D;
  prevTracing: SkeletonTracingType;
  nodes: BufferCollection;
  edges: BufferCollection;
  treeColorTexture: THREE.DataTexture;

  constructor() {
    this.rootNode = new THREE.Object3D();

    const state = Store.getState();
    const trees = state.skeletonTracing.trees;
    const nodeCount = _.sum(_.map(trees, tree => _.size(tree.nodes)));
    const edgeCount = _.sum(_.map(trees, tree => _.size(tree.edges)));

    this.treeColorTexture = new THREE.DataTexture(
      new Float32Array(1024 * 1024 * 3),
      1024,
      1024,
      THREE.RGBFormat,
      THREE.FloatType,
    );

    const nodeMaterial = new NodeShader(this.treeColorTexture).getMaterial();
    const edgeMaterial = new EdgeShader(this.treeColorTexture).getMaterial();

    this.nodes = this.initializeBufferCollection(nodeCount, nodeMaterial, NodeBufferHelper);
    this.edges = this.initializeBufferCollection(edgeCount, edgeMaterial, EdgeBufferHelper);

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

  initializeBufferCollection(initialCapacity: number, material: THREE.Material, helper: BufferHelper): BufferCollection {
    const initialBuffer = this.initializeBuffer(Math.max(initialCapacity, MAX_CAPACITY), material, helper);

    return {
      buffers: [initialBuffer],
      idToBufferPosition: new Map(),
      freeList: [],
      helper,
      material,
    };
  }

  initializeBuffer(capacity: number, material: THREE.Material, helper: BufferHelper): Buffer {
    const geometry = new THREE.BufferGeometry();
    helper.addAttributes(geometry, capacity);
    const mesh = helper.buildMesh(geometry, material);
    this.rootNode.add(mesh);

    return {
      capacity,
      nextIndex: 0,
      geometry,
      mesh,
    };
  }

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
      bufferPosition.buffer.geometry.computeBoundingSphere();
    }
  }

  delete(id: number, collection: BufferCollection, deleteFunc: BufferOperation) {
    const bufferPosition = collection.idToBufferPosition.get(id);
    if (bufferPosition != null) {
      const changedAttributes = deleteFunc(bufferPosition);
      for (const attribute of changedAttributes) {
        attribute.needsUpdate = true;
      }
      collection.idToBufferPosition.delete(id);
      collection.freeList.push(bufferPosition);
    }
  }

  update(id: number, collection: BufferCollection, updateFunc: BufferOperation) {
    const bufferPosition = collection.idToBufferPosition.get(id);
    if (bufferPosition != null) {
      const changedAttributes = updateFunc(bufferPosition);
      for (const attribute of changedAttributes) {
        attribute.needsUpdate = true;
      }
    }
  }

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
        default:
      }
    }

    if (tracing.activeNodeId !== this.prevTracing.activeNodeId) {
      this.startNodeHighlightAnimation();
    }

    const { particleSize, scale, overrideNodeRadius } = state.userConfiguration;
    this.nodes.material.uniforms.planeZoomFactor.value = getPlaneScalingFactor(Store.getState().flycam);
    this.nodes.material.uniforms.overrideParticleSize.value = particleSize;
    this.nodes.material.uniforms.overrideNodeRadius.value = overrideNodeRadius;
    this.nodes.material.uniforms.viewportScale.value = scale;
    this.nodes.material.uniforms.activeTreeId.value = state.skeletonTracing.activeTreeId;
    this.nodes.material.uniforms.activeNodeId.value = state.skeletonTracing.activeNodeId;
    this.nodes.material.uniforms.shouldHideInactiveTrees.value = state.temporaryConfiguration.shouldHideInactiveTrees;
    this.nodes.material.uniforms.shouldHideAllSkeletons.value = state.temporaryConfiguration.shouldHideAllSkeletons;

    this.edges.material.linewidth = state.userConfiguration.particleSize / 4;
    this.edges.material.uniforms.activeTreeId.value = state.skeletonTracing.activeTreeId;
    this.edges.material.uniforms.shouldHideInactiveTrees.value = state.temporaryConfiguration.shouldHideInactiveTrees;
    this.edges.material.uniforms.shouldHideAllSkeletons.value = state.temporaryConfiguration.shouldHideAllSkeletons;

    this.prevTracing = tracing;
  }

  getAllNodes() {
    return _.map(this.nodes.buffers, buffer => buffer.mesh);
  }

  getRootNode() {
    return this.rootNode;
  }

  // API

  // recursive Cantor pairing to generate a unique id from a list of numbers.
  combineIds(...numbers: Array<number>) {
    return numbers.reduce((acc, value) => 0.5 * (acc + value) * (acc + value + 1) + value);
  }

  createTree(tree: TreeType) {
    for (const node of _.values(tree.nodes)) {
      this.createNode(tree.treeId, node, false);
    }
    for (const edge of tree.edges) {
      const source = tree.nodes[edge.source];
      const target = tree.nodes[edge.target];
      this.createEdge(tree.treeId, source, target, false);
    }

    this.updateTreeColor(tree.treeId, tree.color);
  }

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

  deleteNode(treeId: number, nodeId: number) {
    const id = this.combineIds(nodeId, treeId);
    this.delete(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.type;
      attribute.array[index] = NodeTypes.INVALID;
      return [attribute];
    });
  }

  updateNodeRadius(treeId: number, nodeId: number, radius: number) {
    const id = this.combineIds(nodeId, treeId);
    this.update(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.radius;
      attribute.array[index] = radius;
      return [attribute];
    });
  }

  updateNodeType(treeId: number, nodeId: number, type: number) {
    const id = this.combineIds(nodeId, treeId);
    this.update(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.type;
      attribute.array[index] = type;
      return [attribute];
    });
  }

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

  deleteEdge(treeId: number, sourceId: number, targetId: number) {
    const id = this.combineIds(treeId, sourceId, targetId);
    this.delete(id, this.edges, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.position;
      attribute.set([0, 0, 0, 0, 0, 0], index * 6);
      return [attribute];
    });
  }

  updateTreeColor(treeId: number, color: Vector3) {
    this.treeColorTexture.image.data.set(color, treeId * 3);
    this.treeColorTexture.needsUpdate = true;
  }

  setSizeAttenuation(/* sizeAttenuation: boolean */) {
    /* return _.map(this.treeGeometryCache, tree =>
      tree.setSizeAttenuation(sizeAttenuation));*/
  }

  updateForCam(camera: OrthoViewType) {
    const is3DView = camera === OrthoViews.TDView;

    this.nodes.material.uniforms.is3DView.value = is3DView;
    this.edges.material.uniforms.is3DView.value = is3DView;
  }


  async startNodeHighlightAnimation() {
    const normal = 1.0;
    const highlighted = 2.0;

    await this.animateNodeScale(normal, highlighted);
    await this.animateNodeScale(highlighted, normal);
  }

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
