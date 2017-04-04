/**
 * skeleton_geometry_handler.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import Backbone from "backbone";
import ParticleMaterialFactory, { NodeTypes } from "oxalis/geometries/materials/particle_material_factory";
import type { TreeMapType, TreeType } from "oxalis/store";
import type { NodeWithTreeIdType } from "oxalis/model/sagas/update_actions";
import type { Vector3 } from "oxalis/constants";


const MAX_CAPACITY = 1000;

class SkeletonNodeGeometry {
  capacity: number;
  nextIndex: number;
  geometry: THREE.BufferdGeometry;
  material: THREE.Material;
  mesh: THREE.Mesh;
  nodeIdToIndex: Map<number, number>;
  freeList: Array<number>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.nextIndex = 0;
    this.nodeIdToIndex = new Map();
    this.freeList = [];

    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.addAttribute("treeColor", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.addAttribute("radius", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("type", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("nodeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    this.geometry = geometry;

    this.material = ParticleMaterialFactory.getMaterial();
    this.mesh = new THREE.Points(this.geometry, this.material);
  }

  createNode(node: NodeWithTreeIdType, treeColor: Vector3, shouldUpdateBoundingSphere: boolean) {
    const index = this.freeList.pop() || this.nextIndex++;
    this.nodeIdToIndex.set(node.id, index);

    const attributes = this.geometry.attributes;
    attributes.position.set(node.position, index * 3);
    attributes.treeColor.set(treeColor, index * 3);
    attributes.radius.array[index] = node.radius;
    attributes.type.array[index] = NodeTypes.NORMAL;
    attributes.nodeId.array[index] = node.id;
    attributes.treeId.array[index] = node.treeId;

    for (const attribute of _.values(attributes)) {
      attribute.needsUpdate = true;
    }

    if (shouldUpdateBoundingSphere) {
      this.geometry.computeBoundingSphere();
    }
  }

  deleteNode(nodeId: number) {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index != null) {
      this.nodeIdToIndex.delete(nodeId);
      this.geometry.attributes.type.needsUpdate = true;
      this.geometry.attributes.type.array[index] = NodeTypes.INVALID;
      this.freeList.push(index);
    }
  }

  updateNodeScalar(attributeName: string, nodeId: number, value: number) {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index != null) {
      const attribute = this.geometry.attributes[attributeName];
      attribute.array[index] = value;
      attribute.needsUpdate = true;
    }
  }

  updateNodeVector(attributeName: string, nodeId: number, values: Vector3) {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index != null) {
      const attribute = this.geometry.attributes[attributeName];
      attribute.set(values, index * values.length);
      attribute.needsUpdate = true;
    }
  }


  hasCapacity(): boolean {
    return this.freeList.length > 0 || this.nextIndex < this.capacity;
  }


  getMesh() {
    return this.mesh;
  }
}

class SkeletonEdgeGeometry {
  capacity: number;
  nextIndex: number;
  geometry: THREE.BufferdGeometry;
  material: THREE.Material;
  mesh: THREE.Mesh;
  edgeIdToIndex: Map<number, number>;
  freeList: Array<number>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.nextIndex = 0;
    this.edgeIdToIndex = new Map();
    this.freeList = [];

    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 6), 3));
    geometry.addAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    this.geometry = geometry;

    this.material = new THREE.LineBasicMaterial({
      color: new THREE.Color().fromArray([1, 0, 1]),
      linewidth: 10,
    });
    this.mesh = new THREE.LineSegments(this.geometry, this.material);
  }

  createEdge(edgeId: number, source: NodeWithTreeIdType, target: NodeWithTreeIdType) {
    const index = this.freeList.pop() || this.nextIndex++;
    this.edgeIdToIndex.set(edgeId, index);

    const attributes = this.geometry.attributes;
    attributes.position.set(source.position, index * 6);
    attributes.position.set(target.position, index * 6 + 3);

    attributes.position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  deleteEdge(edgeId: number) {
    const index = this.edgeIdToIndex.get(edgeId);
    if (index != null) {
      this.edgeIdToIndex.delete(edgeId);
      this.geometry.attributes.position.set([0, 0, 0, 0, 0, 0], index * 6);
      this.geometry.attributes.position.needsUpdate = true;
      this.freeList.push(index);
    }
  }

  hasCapacity(): boolean {
    return this.freeList.length > 0 || this.nextIndex < this.capacity;
  }

  getMesh() {
    return this.mesh;
  }
}


class SkeletonGeometryHandler {
  trigger: Function;

  nodeGeometries: Array<SkeletonNodeGeometry>;
  nodeIdToGeometry: Map<number, SkeletonNodeGeometry>;
  edgeGeometries: Array<SkeletonEdgeGeometry>;
  edgeIdToGeometry: Map<number, SkeletonEdgeGeometry>;

  constructor(trees: TreeMapType) {
    _.extend(this, Backbone.Events);

    const nodeCount = _.sum(_.map(trees, tree => _.size(tree.nodes)));
    const nodeGeometry = new SkeletonNodeGeometry(Math.max(nodeCount, MAX_CAPACITY));
    this.nodeGeometries = [nodeGeometry];
    this.nodeIdToGeometry = new Map();

    const edgeCount = _.sum(_.map(trees, tree => _.size(tree.edges)));
    const edgeGeometry = new SkeletonEdgeGeometry(edgeCount + MAX_CAPACITY);
    this.edgeGeometries = [edgeGeometry];
    this.edgeIdToGeometry = new Map();

    for (const tree of _.values(trees)) {
      this.createTree(tree);
    }

    nodeGeometry.geometry.computeBoundingSphere();
  }

  createNode(node: NodeWithTreeIdType, treeColor: Vector3, shouldUpdateBoundingSphere:boolean = true) {
    const geometry = this.nodeGeometries[0];
    geometry.createNode(node, treeColor, shouldUpdateBoundingSphere);
    this.nodeIdToGeometry.set(node.id, geometry);

    if (!geometry.hasCapacity()) {
      const newGeometry = new SkeletonNodeGeometry(MAX_CAPACITY);
      this.trigger("newGeometries", [newGeometry.getMesh()]);
      this.nodeGeometries.unshift(newGeometry);
    }
  }

  deleteNode(nodeId: number) {
    const geometry = this.nodeIdToGeometry.get(nodeId);
    if (geometry != null) {
      geometry.deleteNode(nodeId);
      this.nodeIdToGeometry.delete(nodeId);
    }
  }

  updateNodeScalar(attributeName: string, nodeId: number, value: number) {
    const geometry = this.nodeIdToGeometry.get(nodeId);
    if (geometry != null) {
      geometry.updateNodeScalar(attributeName, nodeId, value);
    }
  }

  updateNodeVector(attributeName: string, nodeId: number, values: Vector3) {
    const geometry = this.nodeIdToGeometry.get(nodeId);
    if (geometry != null) {
      geometry.updateNodeVector(attributeName, nodeId, values);
    }
  }

  pair(a: number, b: number) {
    return 0.5 * (a + b) * (a + b + 1) + b;
  }

  createEdge(source: NodeWithTreeIdType, target: NodeWithTreeIdType) {
    const edgeId = this.pair(source.id, target.id);
    const geometry = this.edgeGeometries[0];
    geometry.createEdge(edgeId, source, target);
    this.edgeIdToGeometry.set(edgeId, geometry);

    if (!geometry.hasCapacity()) {
      const newGeometry = new SkeletonEdgeGeometry(MAX_CAPACITY);
      this.trigger("newGeometries", [newGeometry.getMesh()]);
      this.edgeGeometries.unshift(newGeometry);
    }
  }

  deleteEdge(sourceId: number, targetId: number) {
    const edgeId = this.pair(sourceId, targetId);
    const geometry = this.edgeIdToGeometry.get(edgeId);
    if (geometry != null) {
      geometry.deleteEdge(edgeId);
      this.edgeIdToGeometry.delete(edgeId);
    }
  }

  createTree(tree: TreeType) {
    for (const node of _.values(tree.nodes)) {
      this.createNode(node, tree.color, false);
    }
    for (const edge of tree.edges) {
      const source = tree.nodes[edge.source];
      const target = tree.nodes[edge.target];
      this.createEdge(source, target);
    }
  }

  getMeshes() {
    return [...this.nodeGeometries, ...this.edgeGeometries].map(geometry => geometry.getMesh());
  }
}

export default SkeletonGeometryHandler;
