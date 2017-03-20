/**
 * tree.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import * as THREE from "three";
import TWEEN from "tween.js";
import Store from "oxalis/store";
import Model from "oxalis/model";
import ParticleMaterialFactory from "oxalis/geometries/materials/particle_material_factory";
import type { Vector3 } from "oxalis/constants";

class TreeGeometry {

  nodeIDs: Int32Array;
  edgesBuffer: Float32Array;
  nodesBuffer: Float32Array;
  sizesBuffer: Float32Array;
  scalesBuffer: Float32Array;
  nodesColorBuffer: Float32Array;
  edges: THREE.LineSegments;
  particleMaterial: THREE.ShaderMaterial;
  nodes: THREE.Points;
  id: number;
  oldActiveNodeId: ?number;
  oldNodeCount: ?number;

  constructor(treeId: number, treeColor, model: Model) {
    // create skeletonTracing to show in TDView
    const edgeGeometry = new THREE.BufferGeometry();
    const nodeGeometry = new THREE.BufferGeometry();

    this.edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: this.darkenColor(treeColor),
        linewidth: this.getLineWidth(),
      }),
    );

    this.particleMaterial = new ParticleMaterialFactory(model).getMaterial();

    this.nodes = new THREE.Points(nodeGeometry, this.particleMaterial);

    this.id = treeId;
    this.oldActiveNodeId = null;
    this.oldNodeCount = null;

    Store.subscribe(() => {
      const state = Store.getState();
      const { overrideNodeRadius } = state.userConfiguration;
      this.showRadius(!overrideNodeRadius);

      _.defer(() => {
        const activeNodeId = state.skeletonTracing.activeNodeId;
        if (activeNodeId !== this.oldActiveNodeId) {
          this.startNodeHighlightAnimation(activeNodeId);
          this.oldActiveNodeId = activeNodeId;
        }
      });
    });
  }

  makeDynamicFloatAttribute(itemSize, resizableBuffer) {
    const attr = new THREE.BufferAttribute(resizableBuffer, itemSize);
    attr.setDynamic(true);
    return attr;
  }

  reset(nodes, edges) {
    if (this.oldNodeCount !== _.size(nodes)) {
      // only reset if anything has changed, for performance reasons
      // Increases movement perf large tracings
      // Ruins updating node radius and colors for branchpoints etc
      this.resetNodes(nodes);
      this.resetEdges(nodes, edges);

      this.oldNodeCount = _.size(nodes);
    }
  }

  resetEdges(nodes, edges) {
    const edgesBuffer = new Float32Array(edges.length * 6);

    let i = 0;
    for (const edge of edges) {
      const edgePositions = nodes[edge.source].position.concat(nodes[edge.target].position);
      edgesBuffer.set(edgePositions, i * 6);
      i++;
    }

    const edgesMesh = this.edges;

    // Free any memory allocated on the GPU
    edgesMesh.geometry.dispose();

    edgesMesh.geometry.addAttribute("position", this.makeDynamicFloatAttribute(3, edgesBuffer));
    edgesMesh.geometry.computeBoundingSphere();
  }

  resetNodes(nodes) {
    const nodeCount = _.size(nodes);

    if (nodeCount) {
      const sizesBuffer = new Float32Array(nodeCount);
      const scalesBuffer = new Float32Array(nodeCount);
      const nodesBuffer = new Float32Array(nodeCount * 3);
      const nodesColorBuffer = new Float32Array(nodeCount * 3);
      const nodeIDs = [];


      // What is quicker? Setting each element into the TypedArray or creating a temp. (non-immutable) array and setting that as the TypedArray
      let i = 0;
      for (const node of Object.values(nodes)) {
        const indexTimesThree = i * 3;
        sizesBuffer.set([node.radius * 2], i);
        scalesBuffer.set([1.0], i);
        nodesBuffer.set(node.position, indexTimesThree);
        nodesColorBuffer.set(this.getColor(node.id), indexTimesThree);
        nodeIDs.push(node.id);

        i++;
      }

      const nodesMesh = this.nodes;

      // Free any memory allocated on the GPU
      nodesMesh.geometry.dispose();

      nodesMesh.geometry.addAttribute("position", this.makeDynamicFloatAttribute(3, nodesBuffer));
      nodesMesh.geometry.addAttribute("sizeNm", this.makeDynamicFloatAttribute(1, sizesBuffer));
      nodesMesh.geometry.addAttribute("nodeScaleFactor", this.makeDynamicFloatAttribute(1, scalesBuffer));
      nodesMesh.geometry.addAttribute("color", this.makeDynamicFloatAttribute(3, nodesColorBuffer));
      nodesMesh.geometry.nodeIDs = nodeIDs;

      nodesMesh.geometry.computeBoundingSphere();
      // nodesMesh.geometry.setDrawRange(0, nodeCount);
    }
  }

  setSizeAttenuation(sizeAttenuation) {
    this.nodes.material.sizeAttenuation = sizeAttenuation;
    // this.updateGeometries();
  }

  getMeshes() {
    return [this.nodes, this.edges];
  }

  dispose() {
    for (const geometry of this.getMeshes()) {
      geometry.geometry.dispose();
      geometry.material.dispose();
    }
  }

  startNodeHighlightAnimation(nodeId) {
    const normal = 1.0;
    const highlighted = 2.0;

    const nodeIndex = this.getNodeIndex(nodeId);
    if (nodeIndex) {
      this.animateNodeScale(normal, highlighted, nodeIndex, () => this.animateNodeScale(highlighted, normal, nodeIndex));
    }
  }

  animateNodeScale(from, to, index, onComplete = _.noop) {
    //const setScaleFactor = factor => this.scalesBuffer.set([factor], index);
    const redraw = () => {
      // this.updateGeometries();
      app.vent.trigger("rerender");
    };
    const onUpdate = function () {
      // setScaleFactor(this.scaleFactor);
      redraw();
    };

    const tweenAnimation = new TWEEN.Tween({ scaleFactor: from });
    tweenAnimation
      .to({ scaleFactor: to }, 100)
      .onUpdate(onUpdate)
      .onComplete(onComplete)
      .start();
  }

  getNodeIndex(nodeId) {
    for (let i = 0; i < this.nodes.geometry.nodeIDs.length; i++) {
      if (this.nodes.geometry.nodeIDs[i] === nodeId) {
        return i;
      }
    }
    return null;
  }

  getColor(id) {
    const tree = Store.getState().skeletonTracing.trees[this.id];
    let { color } = tree;

    if (id != null) {
      const isActiveNode = Store.getState().skeletonTracing.activeNodeId === id;
      const isBranchPoint = !_.isEmpty(tree.branchPoints.filter(branchPoint => branchPoint.id === id));

      if (isActiveNode) {
        color = this.shiftColor(color, 1 / 4);
      } else {
        color = this.darkenColor(color);
      }

      if (isBranchPoint) {
        color = this.invertColor(color);
      }
    }

    return color;
  }

  showRadius(show) {
    this.edges.material.linewidth = this.getLineWidth();
    this.particleMaterial.setShowRadius(show);
  }


  getLineWidth() {
    return Store.getState().userConfiguration.particleSize / 4;
  }


  // ### Color utility methods

  darkenColor(color: Vector3): Vector3 {
    const threeColor = new THREE.Color().fromArray(color);
    const hslColor = threeColor.getHSL();
    threeColor.setHSL(hslColor.h, hslColor.s, 0.25);
    return threeColor.toArray();
  }


  shiftColor(color: Vector3, shiftValue): Vector3 {
    const threeColor = new THREE.Color().fromArray(color);
    threeColor.offsetHSL(shiftValue, 0, 0);
    return threeColor.toArray();
  }


  invertColor(color: Vector3): Vector3 {
    return this.shiftColor(color, 0.5);
  }
}

export default TreeGeometry;
