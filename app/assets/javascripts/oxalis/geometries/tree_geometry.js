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

  constructor(treeId: number, treeColor, model: Model) {
    // create skeletonTracing to show in TDView
    const edgeGeometry = new THREE.BufferGeometry();
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.nodeIDs = [];

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
    this.resetNodes(nodes);
    this.resetEdges(nodes, edges);
  }

  resetEdges(nodes, edges) {
    const edgesBuffer = [];

    for (const edge of edges) {
      const sourceNodePosition = nodes[edge.source].position;
      const targetNodePosition = nodes[edge.target].position;
      edgesBuffer.push(sourceNodePosition[0], sourceNodePosition[1], sourceNodePosition[2], targetNodePosition[0], targetNodePosition[1], targetNodePosition[2]);
    }

    const edgesMesh = this.edges;
    edgesMesh.geometry.dispose(); // Free any memory allocated on the GPU

    edgesMesh.geometry.addAttribute("position", this.makeDynamicFloatAttribute(3, new Float32Array(edgesBuffer)));
    edgesMesh.geometry.computeBoundingSphere();
  }

  resetNodes(nodes) {
    const nodeCount = _.size(nodes);

    if (nodeCount) {
      const sizesBuffer = [];
      const scalesBuffer = [];
      const positionBuffer = [];
      const colorBuffer = [];
      const nodeIDs = [];

      // explicitly use loop here for performance reasons #perfmatters
      for (const node of Object.values(nodes)) {
        const nodeColor = this.getColor(node.id);

        sizesBuffer.push(node.radius * 2);
        scalesBuffer.push(1.0);
        positionBuffer.push(node.position[0], node.position[1], node.position[2]);
        colorBuffer.push(nodeColor[0], nodeColor[1], nodeColor[2]);
        nodeIDs.push(node.id);
      }

      const nodesMesh = this.nodes;
      nodesMesh.geometry.dispose(); // Free any memory allocated on the GPU

      nodesMesh.geometry.addAttribute("position", this.makeDynamicFloatAttribute(3, new Float32Array(positionBuffer)));
      nodesMesh.geometry.addAttribute("sizeNm", this.makeDynamicFloatAttribute(1, new Float32Array(sizesBuffer)));
      nodesMesh.geometry.addAttribute("nodeScaleFactor", this.makeDynamicFloatAttribute(1, new Float32Array(scalesBuffer)));
      nodesMesh.geometry.addAttribute("color", this.makeDynamicFloatAttribute(3, new Float32Array(colorBuffer)));
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

    const nodeIndex = _.findIndex(this.nodes.geometry.nodeIDs, id => id === nodeId);
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
