// @flow
import _ from "lodash";
import * as THREE from "three";
import Backbone from "backbone";
import ParticleMaterialFactory, { NodeTypes } from "oxalis/geometries/materials/particle_material_factory";
import type { TreeMapType, TreeType } from "oxalis/store";
import type { NodeWithTreeIdType } from "oxalis/model/sagas/update_actions";


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
    geometry.addAttribute("radius", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("type", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("nodeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.addAttribute("treeId", new THREE.BufferAttribute(new Float32Array(capacity), 1));
    this.geometry = geometry;

    this.material = ParticleMaterialFactory.getMaterial();
    this.mesh = new THREE.Points(this.geometry, this.material);
  }


  createNode(node: NodeWithTreeIdType, shouldUpdateBoundingSphere: boolean) {
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

  updateNodeAttribute(nodeId: number, attributeName: string, value: number) {
    const index = this.nodeIdToIndex.get(nodeId);
    if (index != null) {
      const attribute = this.geometry.attributes[attributeName];
      attribute.array[index] = value;
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

class SkeletonGeometryHandler {
  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  trigger: Function;

  nodeGeometries: Array<SkeletonNodeGeometry>;
  nodeIdToGeometry: Map<number, SkeletonNodeGeometry>;

  constructor(trees: TreeMapType) {
    _.extend(this, Backbone.Events);

    const nodeCount = _.sum(_.map(trees, tree => _.size(tree.nodes)));
    const nodeGeometry = new SkeletonNodeGeometry(Math.max(nodeCount, MAX_CAPACITY));
    this.nodeGeometries = [nodeGeometry];
    this.nodeIdToGeometry = new Map();

    for (const tree of _.values(trees)) {
      this.createTree(tree);
    }

    nodeGeometry.geometry.computeBoundingSphere();
  }

  createNode(node: NodeWithTreeIdType, shouldUpdateBoundingSphere:boolean = true) {
    const geometry = this.nodeGeometries[0];
    geometry.createNode(node, shouldUpdateBoundingSphere);
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

  updateNodeType(nodeId: number, type: number) {
    const geometry = this.nodeIdToGeometry.get(nodeId);
    if (geometry != null) {
      geometry.updateNodeAttribute(nodeId, "type", type);
    }
  }

  updateNodeRadius(nodeId: number, radius: number) {
    const geometry = this.nodeIdToGeometry.get(nodeId);
    if (geometry != null) {
      geometry.updateNodeAttribute(nodeId, "radius", radius);
    }
  }

  createEdge() {
    // TODO
  }

  deleteEdge() {
    // TODO
  }

  createTree(tree: TreeType) {
    for (const node of _.values(tree.nodes)) {
      this.createNode(node, false);
    }
    for (const edge of tree.edges) {
      const source = tree.nodes[edge.source];
      const target = tree.nodes[edge.target];
      this.createEdge(edge, source, target);
    }
  }

  getMeshes() {
    const nodes = _.map(this.nodeGeometries, geometry => geometry.getMesh());
    const edges = [];// _.map(this.edgeGeometries, geometry => geometry.getMesh());
    return [...nodes, ...edges];
  }
}

export default SkeletonGeometryHandler;
