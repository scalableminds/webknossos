/**
 * tree.js
 * @flow weak
 */

import _ from "lodash";
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
  particleMaterial: THREE.RawShaderMaterial;
  nodes: THREE.Points;
  id: number;
  oldActiveNodeId: ?number;

  constructor(treeId: number, treeColor, model: Model) {
    // create skeletonTracing to show in TDView
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));

    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    nodeGeometry.addAttribute("sizeNm", new THREE.BufferAttribute(new Float32Array(1), 1));
    nodeGeometry.addAttribute("nodeScaleFactor", new THREE.BufferAttribute(new Float32Array(1), 1));
    nodeGeometry.addAttribute("color", new THREE.BufferAttribute(new Float32Array(3), 3));
    nodeGeometry.nodeIDs = [];

    this.edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: new THREE.Color().fromArray(this.darkenColor(treeColor)),
        linewidth: this.getLineWidth(),
      }),
    );

    this.particleMaterial = new ParticleMaterialFactory(model).getMaterial();

    this.nodes = new THREE.Points(nodeGeometry, this.particleMaterial);

    this.id = treeId;
    this.oldActiveNodeId = null;

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

  reset(nodes, edges) {
    this.resetNodes(nodes);
    this.resetEdges(nodes, edges);
  }

  resetEdges(nodes, edges) {
    const edgesBuffer = new Array(_.size(edges) * 6);

    let i = 0;
    for (const edge of edges) {
      const sourceNodePosition = nodes[edge.source].position;
      const targetNodePosition = nodes[edge.target].position;
      edgesBuffer[i] = sourceNodePosition[0];
      edgesBuffer[i + 1] = sourceNodePosition[1];
      edgesBuffer[i + 2] = sourceNodePosition[2];
      edgesBuffer[i + 3] = targetNodePosition[0];
      edgesBuffer[i + 4] = targetNodePosition[1];
      edgesBuffer[i + 5] = targetNodePosition[2];

      i += 6;
    }

    const edgesMesh = this.edges;
    edgesMesh.geometry.attributes.position.setArray(new Float32Array(edgesBuffer));
    edgesMesh.geometry.attributes.position.needsUpdate = true;
    edgesMesh.geometry.computeBoundingSphere();
  }

  resetNodes(nodes) {
    const nodeCount = _.size(nodes);

    if (nodeCount) {
      const sizesBuffer = new Array(nodeCount);
      const scalesBuffer = new Array(nodeCount);
      const positionBuffer = new Array(nodeCount * 3);
      const colorBuffer = new Array(nodeCount * 3);
      const nodeIDs = new Array(nodeCount);

      // explicitly use loop here for performance reasons #perfmatters
      let i = 0;
      for (const node of _.values(nodes)) {
        const nodeColor = this.getColor(node.id);
        const indexTimesThree = i * 3;

        sizesBuffer[i] = node.radius * 2;
        scalesBuffer[i] = 1.0;
        positionBuffer[indexTimesThree] = node.position[0];
        positionBuffer[indexTimesThree + 1] = node.position[1];
        positionBuffer[indexTimesThree + 2] = node.position[2];
        colorBuffer[indexTimesThree] = nodeColor[0];
        colorBuffer[indexTimesThree + 1] = nodeColor[1];
        colorBuffer[indexTimesThree + 2] = nodeColor[2];
        nodeIDs[i] = node.id;

        i++;
      }

      const nodesMesh = this.nodes;
      nodesMesh.geometry.attributes.position.setArray(new Float32Array(positionBuffer));
      nodesMesh.geometry.attributes.sizeNm.setArray(new Float32Array(sizesBuffer));
      nodesMesh.geometry.attributes.nodeScaleFactor.setArray(new Float32Array(scalesBuffer));
      nodesMesh.geometry.attributes.color.setArray(new Float32Array(colorBuffer));
      nodesMesh.geometry.nodeIDs = nodeIDs;

      nodesMesh.geometry.attributes.position.needsUpdate = true;
      nodesMesh.geometry.attributes.sizeNm.needsUpdate = true;
      nodesMesh.geometry.attributes.nodeScaleFactor.needsUpdate = true;
      nodesMesh.geometry.attributes.color.needsUpdate = true;

      nodesMesh.geometry.computeBoundingSphere();
    }
  }

  setSizeAttenuation(sizeAttenuation) {
    this.nodes.material.sizeAttenuation = sizeAttenuation;
    this.nodes.material.needsUpdate = true;
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

    const nodeIndex = _.findIndex(this.nodes.geometry.nodeIDs, id => id === nodeId);
    if (nodeIndex >= 0) {
      this.animateNodeScale(normal, highlighted, nodeIndex, () => this.animateNodeScale(highlighted, normal, nodeIndex));
    }
  }

  animateNodeScale(from, to, index, onComplete = _.noop) {
    const setScaleFactor = (factor) => {
      this.nodes.geometry.attributes.nodeScaleFactor.set([factor], index);
      this.nodes.geometry.attributes.nodeScaleFactor.needsUpdate = true;
    };

    const onUpdate = function () {
      setScaleFactor(this.scaleFactor);
    };

    const tweenAnimation = new TWEEN.Tween({ scaleFactor: from });
    tweenAnimation
      .to({ scaleFactor: to }, 100)
      .onUpdate(onUpdate)
      .onComplete(onComplete)
      .start();
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
