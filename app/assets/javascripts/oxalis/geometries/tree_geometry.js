/**
 * tree.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import ResizableBuffer from "libs/resizable_buffer";
import ErrorHandling from "libs/error_handling";
import * as THREE from "three";
import TWEEN from "tween.js";
import Store from "oxalis/store";
import Model from "oxalis/model";
import ParticleMaterialFactory from "oxalis/geometries/materials/particle_material_factory";
import type { Vector3 } from "oxalis/constants";

class TreeGeometry {

  nodeIDs: ResizableBuffer<Int32Array>;
  edgesBuffer: ResizableBuffer<Float32Array>;
  nodesBuffer: ResizableBuffer<Float32Array>;
  sizesBuffer: ResizableBuffer<Float32Array>;
  scalesBuffer: ResizableBuffer<Float32Array>;
  nodesColorBuffer: ResizableBuffer<Float32Array>;
  edges: THREE.LineSegments;
  particleMaterial: THREE.ShaderMaterial;
  nodes: THREE.Points;
  id: number;

  constructor(treeId: number, treeColor, model: Model) {
    // create skeletonTracing to show in TDView and pre-allocate buffers

    const edgeGeometry = new THREE.BufferGeometry();
    const nodeGeometry = new THREE.BufferGeometry();

    this.nodeIDs = new ResizableBuffer(1, Int32Array, 100);
    this.edgesBuffer = new ResizableBuffer(6, Float32Array);
    this.nodesBuffer = new ResizableBuffer(3, Float32Array);
    this.sizesBuffer = new ResizableBuffer(1, Float32Array);
    this.scalesBuffer = new ResizableBuffer(1, Float32Array);
    this.nodesColorBuffer = new ResizableBuffer(3, Float32Array);

    edgeGeometry.addAttribute("position", this.makeDynamicFloatAttribute(3, this.edgesBuffer));
    nodeGeometry.addAttribute("position", this.makeDynamicFloatAttribute(3, this.nodesBuffer));
    nodeGeometry.addAttribute("sizeNm", this.makeDynamicFloatAttribute(1, this.sizesBuffer));
    nodeGeometry.addAttribute("nodeScaleFactor", this.makeDynamicFloatAttribute(1, this.scalesBuffer));
    nodeGeometry.addAttribute("color", this.makeDynamicFloatAttribute(3, this.nodesColorBuffer));

    nodeGeometry.nodeIDs = this.nodeIDs;

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

    Store.subscribe(() => {
      const { overrideNodeRadius } = Store.getState().userConfiguration;
      this.showRadius(!overrideNodeRadius);
    });
  }

  makeDynamicFloatAttribute(itemSize, resizableBuffer) {
    const attr = new THREE.BufferAttribute(resizableBuffer.getBuffer(), itemSize);
    attr.setDynamic(true);
    return attr;
  }

  clear() {
    this.nodesBuffer.clear();
    this.edgesBuffer.clear();
    this.sizesBuffer.clear();
    this.scalesBuffer.clear();
    this.nodeIDs.clear();
  }

  reset(nodes, edges) {
    if (_.size(nodes)) {
      this.clear();

      this.nodesBuffer.pushMany(_.map(nodes, "position"));
      this.sizesBuffer.pushMany(_.map(nodes, node => [node.radius * 2]));
      this.scalesBuffer.pushMany(_.times(_.size(nodes), _.constant([1.0])));
      this.nodeIDs.pushMany(_.map(nodes, node => [node.id]));
      this.nodesColorBuffer.pushMany(_.map(nodes, node => this.getColor(node.id)));
      this.edgesBuffer.pushMany(edges.map(edge => nodes[edge.source].position.concat(nodes[edge.target].position)));

      this.updateGeometries();
    }
  }

  setSizeAttenuation(sizeAttenuation) {
    this.nodes.material.sizeAttenuation = sizeAttenuation;
    this.updateGeometries();
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

    // this.doWithNodeIndex(nodeId, index => this.animateNodeScale(normal, highlighted, index, () => this.animateNodeScale(highlighted, normal, index)),
  }


  animateNodeScale(from, to, index, onComplete) {
    if (onComplete == null) { onComplete = function () {}; }
    const setScaleFactor = factor => this.scalesBuffer.set([factor], index);
    const redraw = () => {
      this.updateGeometries();
      app.vent.trigger("rerender");
    };
    const onUpdate = function () {
      setScaleFactor(this.scaleFactor);
      redraw();
    };

    (new TWEEN.Tween({ scaleFactor: from }))
      .to({ scaleFactor: to }, 100)
      .onUpdate(onUpdate)
      .onComplete(onComplete)
      .start();
  }


  getColor(id, isActiveNode, isBranchPoint) {
    const tree = Store.getState().skeletonTracing.trees[this.id];
    let { color } = tree;

    if (id != null) {
      isActiveNode = isActiveNode || Store.getState().skeletonTracing.activeNodeId === id;
      isBranchPoint = isBranchPoint || id in _.map(tree.branchPoints, "node");

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


  updateGeometries() {
    this.updateGeometry(this.nodes, {
      position: [3, this.nodesBuffer],
      sizeNm: [1, this.sizesBuffer],
      nodeScaleFactor: [1, this.scalesBuffer],
      color: [3, this.nodesColorBuffer],
    });

    this.updateGeometry(this.edges, {
      position: [3, this.edgesBuffer],
    }, 2);
  }


  updateGeometry(mesh, attribute2buffer, itemsPerElement = 1) {
    let length = -1;
    let needsToRebuildGeometry = false;
    for (const attribute of Object.keys(attribute2buffer)) {
      const rBuffer = attribute2buffer[attribute][1];

      if (length === -1) {
        length = rBuffer.getLength();
      } else {
        ErrorHandling.assertEquals(rBuffer.getLength(), length,
          "All attribute lengths should be equal.");
      }

      if (mesh.geometry.attributes[attribute].array !== rBuffer.getBuffer()) {
        // The reference of the underlying buffer has changed. Unfortunately,
        // this means that we have to re-create all of the attributes.
        needsToRebuildGeometry = true;
      }
      mesh.geometry.attributes[attribute].needsUpdate = true;
    }

    if (needsToRebuildGeometry) {
      // Free any memory allocated on the GPU
      mesh.geometry.dispose();
      for (const attribute of Object.keys(attribute2buffer)) {
        // Recreate attribute
        const [itemSize, rBuffer] = attribute2buffer[attribute];
        mesh.geometry.addAttribute(attribute, this.makeDynamicFloatAttribute(itemSize, rBuffer));
      }
    }
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.setDrawRange(0, length * itemsPerElement);
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
