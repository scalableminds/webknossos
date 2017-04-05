/**
 * skeleton.js
 * @flow
 */

import _ from "lodash";
import Backbone from "backbone";
import * as THREE from "three";
import Utils from "libs/utils";
import Store from "oxalis/throttled_store";
import type { SkeletonTracingType, TreeType, NodeType } from "oxalis/store";
import type { NodeWithTreeIdType } from "oxalis/model/sagas/update_actions";
import { diffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import ParticleMaterialFactory, { NodeTypes } from "oxalis/geometries/materials/particle_material_factory";
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
}

type BufferOperation = (position: BufferPosition) => Array<THREE.BufferAttribute>;

const NodeBufferHelper = {
  addAttributes(geometry: THREE.BufferGeometry, capacity: number): void {
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.addAttribute("treeColor", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.addAttribute("radius", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("type", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("nodeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
  },

  buildMesh(geometry: THREE.BufferGeometry): THREE.Mesh {
    const material = ParticleMaterialFactory.getMaterial();
    return new THREE.Points(geometry, material);
  },
};

const EdgeBufferHelper = {
  addAttributes(geometry: THREE.BufferGeometry, capacity: number): void {
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 6), 3));
  },

  buildMesh(geometry: THREE.BufferGeometry): THREE.Mesh {
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().fromArray([1, 0, 1]),
      linewidth: 10,
    });
    return new THREE.LineSegments(geometry, material);
  },
};

class Skeleton {
  // This class is supposed to collect all the Geometries that belong to the skeleton, like
  // nodes, edges and trees

  trigger: Function; // TODO remove

  // TODO move to store?
  isVisible: boolean;
  showInactiveTrees: boolean;


  prevTracing: SkeletonTracingType;

  nodes: BufferCollection;
  edges: BufferCollection;

  constructor() {
    _.extend(this, Backbone.Events);

    this.isVisible = true;
    this.showInactiveTrees = true;

    const trees = Store.getState().skeletonTracing.trees;
    const nodeCount = _.sum(_.map(trees, tree => _.size(tree.nodes)));
    const edgeCount = _.sum(_.map(trees, tree => _.size(tree.edges)));
    this.nodes = this.initializeBufferCollection(nodeCount, NodeBufferHelper);
    this.edges = this.initializeBufferCollection(edgeCount, EdgeBufferHelper);

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

  initializeBufferCollection(initialCapacity: number, helper: BufferHelper): BufferCollection {
    const initialBuffer = this.initializeBuffer(Math.max(initialCapacity, MAX_CAPACITY), helper);

    return {
      buffers: [initialBuffer],
      idToBufferPosition: new Map(),
      freeList: [],
      helper,
    };
  }

  initializeBuffer(capacity: number, helper: BufferHelper): Buffer {
    const geometry = new THREE.BufferGeometry();
    helper.addAttributes(geometry, capacity);
    return {
      capacity,
      nextIndex: 0,
      geometry,
      mesh: helper.buildMesh(geometry),
    };
  }

  create(id: number, collection: BufferCollection, updateBoundingSphere: boolean, createFunc: BufferOperation) {
    let currentBuffer = collection.buffers[0];
    if (collection.freeList.length === 0 && currentBuffer.nextIndex >= currentBuffer.capacity) {
      currentBuffer = this.initializeBuffer(MAX_CAPACITY, collection.helper);
      this.trigger("newGeometries", [currentBuffer.mesh]); // TODO remove
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
    const tracing = Store.getState().skeletonTracing;
    const diff = diffTrees(this.prevTracing.trees, tracing.trees);

    for (const update of diff) {
      switch (update.action) {
        case "createNode": {
          const treeColor = tracing.trees[update.value.treeId].color;
          this.createNode(update.value, treeColor);
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
            for (const node of _.values(tree.nodes)) {
              this.updateNodeColor(treeId, node.id, tree.color);
            }
          }
          break;
        }
        default:
      }
    }

    this.prevTracing = tracing;
  }

  getAllNodes() {
    return _.map(this.nodes.buffers, buffer => buffer.mesh);
  }

  getMeshes() {
    return [...this.nodes.buffers, ...this.edges.buffers].map(buffer => buffer.mesh);
  }

  // API

  // recursive Cantor pairing to generate a unique id from a list of numbers.
  combine(...numbers: Array<number>) {
    return numbers.reduce((acc, value) => 0.5 * (acc + value) * (acc + value + 1) + value);
  }

  createTree(tree: TreeType) {
    for (const node of _.values(tree.nodes)) {
      this.createNode(node, tree.color, false);
    }
    for (const edge of tree.edges) {
      const source = tree.nodes[edge.source];
      const target = tree.nodes[edge.target];
      this.createEdge(tree.treeId, source, target, false);
    }
  }

  createNode(node: NodeWithTreeIdType, treeColor: Vector3, updateBoundingSphere: boolean = true) {
    const id = this.combine(node.id, node.treeId);
    this.create(id, this.nodes, updateBoundingSphere, ({ buffer, index }) => {
      const attributes = buffer.geometry.attributes;
      attributes.position.set(node.position, index * 3);
      attributes.treeColor.set(treeColor, index * 3);
      attributes.radius.array[index] = node.radius;
      attributes.type.array[index] = NodeTypes.NORMAL;
      attributes.nodeId.array[index] = node.id;
      attributes.treeId.array[index] = node.treeId;
      return _.values(attributes);
    });
  }

  deleteNode(treeId: number, nodeId: number) {
    const id = this.combine(nodeId, treeId);
    this.delete(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.type;
      attribute.array[index] = NodeTypes.INVALID;
      return [attribute];
    });
  }

  updateNodeColor(treeId: number, nodeId: number, color: Vector3) {
    const id = this.combine(nodeId, treeId);
    this.update(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.color;
      attribute.set(color, index * 3);
      return [attribute];
    });
  }

  updateNodeRadius(treeId: number, nodeId: number, radius: number) {
    const id = this.combine(nodeId, treeId);
    this.update(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.radius;
      attribute.array[index] = radius;
      return [attribute];
    });
  }

  updateNodeType(treeId: number, nodeId: number, type: number) {
    const id = this.combine(nodeId, treeId);
    this.update(id, this.nodes, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.type;
      attribute.array[index] = type;
      return [attribute];
    });
  }

  createEdge(treeId: number, source: NodeType, target: NodeType, updateBoundingSphere: boolean = true) {
    const id = this.combine(treeId, source.id, target.id);
    this.create(id, this.edges, updateBoundingSphere, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.position;
      attribute.set(source.position, index * 6);
      attribute.set(target.position, index * 6 + 3);
      return [attribute];
    });
  }

  deleteEdge(treeId: number, sourceId: number, targetId: number) {
    const id = this.combine(treeId, sourceId, targetId);
    this.delete(id, this.edges, ({ buffer, index }) => {
      const attribute = buffer.geometry.attributes.position;
      attribute.set([0, 0, 0, 0, 0, 0], index * 6);
      return [attribute];
    });
  }

  setVisibility(isVisible: boolean) {
    this.isVisible = isVisible;

    /* for (const mesh of this.getMeshes()) {
      mesh.isVisible = isVisible;
    }
    app.vent.trigger("rerender"); */
  }


  setVisibilityTemporary(/* isVisible: boolean */) {
    // for (const mesh of this.getMeshes()) {
    //   mesh.visible = isVisible && ((mesh.isVisible != null) ? mesh.isVisible : true);
    // }
    // (TODO: still needed?) app.vent.trigger("rerender");
  }


  restoreVisibility() {
//    this.setVisibilityTemporary(this.isVisible);
  }


  toggleVisibility() {
    this.setVisibility(!this.isVisible);
  }


  updateForCam(/* id: OrthoViewType */) {
    /* for (const tree of _.values(this.treeGeometryCache)) {
      //tree.showRadius(id !== OrthoViews.TDView && !Store.getState().userConfiguration.overrideNodeRadius);
    }

    if (id !== OrthoViews.TDView) {
      this.setVisibilityTemporary(this.isVisible);
    }
    this.setVisibilityTemporary(true);*/
  }


  toggleInactiveTreeVisibility() {
    // this.showInactiveTrees = !this.showInactiveTrees;
    // return this.setInactiveTreeVisibility(this.showInactiveTrees);
  }


  setInactiveTreeVisibility(/* isVisible: boolean */) {
    /* for (const mesh of this.getMeshes()) {
      mesh.isVisible = visible;
    }
    const treeGeometry = this.getTreeGeometry(Store.getState().skeletonTracing.activeTreeId);
    if (treeGeometry != null) {
      treeGeometry.edges.isVisible = true;
      treeGeometry.nodes.isVisible = true;
      app.vent.trigger("rerender");
    } */
  }


  setSizeAttenuation(/* sizeAttenuation: boolean */) {
    /* return _.map(this.treeGeometryCache, tree =>
      tree.setSizeAttenuation(sizeAttenuation));*/
  }
}

export default Skeleton;
