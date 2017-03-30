// @flow
import _ from "lodash";
import * as THREE from "three";
import Backbone from "backbone";
import ParticleMaterialFactory from "oxalis/geometries/materials/particle_material_factory";
import Model from "oxalis/model";
import type { TreeMapType, TreeType } from "oxalis/store";
import type { NodeWithTreeIdType } from "oxalis/model/sagas/update_actions";

const NodeTypes = {
  INVALID: -1.0,
  NORMAL: 0.0,
  BRANCH_POINT: 1.0,
};

class SkeletonNodeGeometry {
  capacity: number;
  nextIndex: number;
  geometry: THREE.BufferdGeometry;
  material: THREE.Material;
  mesh: THREE.Mesh;
  nodeIdToIndex: Map<number, number>;
  freeList: Array<number>;

  constructor(capacity: number, model: Model) {
    this.capacity = capacity;
    this.nextIndex = 0;
    this.nodeIdToIndex = new Map();
    this.freeList = [];

    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.addAttribute("radius", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("type", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("nodeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    this.geometry = geometry;

    this.material = new ParticleMaterialFactory(model).getMaterial();
    this.mesh = new THREE.Points(this.geometry, this.material);
  }


  addNode(node: NodeWithTreeIdType) {
    const index = this.freeList.pop() || this.nextIndex++;
    this.nodeIdToIndex.set(node.id, index);

    const attributes = this.geometry.attributes;
    attributes.position.set(node.position, index * 3);
    attributes.radius.array[index] = node.radius;
    attributes.type.array[index] = NodeTypes.NORMAL;
    attributes.nodeId.array[index] = node.id;
    attributes.treeId.array[index] = node.treeId;

    for (const attribute of _.values(attributes)) {
      attribute.needsUpdate = true;
    }
  }


  removeNode(nodeId) {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index != null) {
      this.nodeIdToIndex.delete(nodeId);
      this.geometry.attributes.type.needsUpdate = true;
      this.geometry.attributes.type.array[index] = NodeTypes.BRANCH_POINT;
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
  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  trigger: Function;

  model: Model;
  nodeGeometries: Array<SkeletonNodeGeometry>;
  nodeIdToGeometry: Map<number, SkeletonNodeGeometry>;

  constructor(trees: TreeMapType, model: Model) {
    _.extend(this, Backbone.Events);

    this.model = model;
    const nodeCount = _.sum(_.map(trees, tree => _.size(tree.nodes)));
    const nodeGeometry = new SkeletonNodeGeometry(nodeCount + 1000, this.model);
    this.nodeGeometries = [nodeGeometry];
    this.nodeIdToGeometry = new Map();

    for (const tree of _.values(trees)) {
      this.addTree(tree);
    }
  }

  addNode(node: NodeWithTreeIdType) {
    const geometry = this.nodeGeometries[0];
    geometry.addNode(node);
    this.nodeIdToGeometry.set(node.id, geometry);

    if (!geometry.hasCapacity()) {
      const newGeometry = new SkeletonNodeGeometry(1000, this.model);
      this.trigger("newGeometries", [newGeometry]);
      this.nodeGeometries.unshift(newGeometry);
    }
  }

  removeNode(nodeId: number) {
    const geometry = this.nodeIdToGeometry.get(nodeId);
    if (geometry != null) {
      geometry.removeNode(nodeId);
      this.nodeIdToGeometry.delete(nodeId);
    }
  }

  addEdge() {
    // TODO
  }

  removeEdge() {
    // TODO
  }

  addTree(tree: TreeType) {
    for (const node of _.values(tree.nodes)) {
      this.addNode(node);
    }
    for (const edge of tree.edges) {
      const source = tree.nodes[edge.source];
      const target = tree.nodes[edge.target];
      this.addEdge(edge, source, target);
    }
  }

  getMeshes() {
    const nodes = _.map(this.nodeGeometries, geometry => geometry.getMesh());
    const edges = [];// _.map(this.edgeGeometries, geometry => geometry.getMesh());
    return [...nodes, ...edges];
  }
}

export default SkeletonGeometryHandler;
