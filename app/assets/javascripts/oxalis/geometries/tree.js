/**
 * tree.js
 * @flow weak
 */

import app from "app";
import Utils from "libs/utils";
import ResizableBuffer from "libs/resizable_buffer";
import ErrorHandling from "libs/error_handling";
import * as THREE from "three";
import TWEEN from "tween.js";
import Model from "oxalis/model";
import ParticleMaterialFactory from "./materials/particle_material_factory";

class Tree {

  model: Model;
  nodeIDs: ResizableBuffer;
  edgesBuffer: ResizableBuffer;
  nodesBuffer: ResizableBuffer;
  sizesBuffer: ResizableBuffer;
  scalesBuffer: ResizableBuffer;
  nodesColorBuffer: ResizableBuffer;
  edges: THREE.Line;
  particleMaterial: THREE.ShaderMaterial;
  nodes: THREE.ParticleSystem;
  id: number;

  constructor(treeId, treeColor, model) {
    // create skeletonTracing to show in TDView and pre-allocate buffers

    this.model = model;
    const edgeGeometry = new THREE.BufferGeometry();
    const nodeGeometry = new THREE.BufferGeometry();

    this.nodeIDs = new ResizableBuffer(1, 100, Int32Array);
    this.edgesBuffer = new ResizableBuffer(6);
    this.nodesBuffer = new ResizableBuffer(3);
    this.sizesBuffer = new ResizableBuffer(1);
    this.scalesBuffer = new ResizableBuffer(1);
    this.nodesColorBuffer = new ResizableBuffer(3);

    edgeGeometry.addAttribute("position", this.makeDynamicFloatAttribute(3, this.edgesBuffer));
    nodeGeometry.addAttribute("position", this.makeDynamicFloatAttribute(3, this.nodesBuffer));
    nodeGeometry.addAttribute("sizeNm", this.makeDynamicFloatAttribute(1, this.sizesBuffer));
    nodeGeometry.addAttribute("nodeScaleFactor", this.makeDynamicFloatAttribute(1, this.scalesBuffer));
    nodeGeometry.addAttribute("color", this.makeDynamicFloatAttribute(3, this.nodesColorBuffer));

    nodeGeometry.nodeIDs = this.nodeIDs;

    this.edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: this.darkenHex(treeColor),
        linewidth: this.getLineWidth(),
      }),
    );

    this.particleMaterial = new ParticleMaterialFactory(this.model).getMaterial();

    this.nodes = new THREE.Points(nodeGeometry, this.particleMaterial);

    this.id = treeId;
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
    this.updateNodesColors();
  }


  isEmpty() {
    return this.nodesBuffer.getLength() === 0;
  }


  addNode(node) {
    this.nodesBuffer.push(node.position);
    this.sizesBuffer.push([node.radius * 2]);
    this.scalesBuffer.push([1.0]);
    this.nodeIDs.push([node.id]);
    this.nodesColorBuffer.push(this.getColor(node.id));

    // Add any edge from smaller IDs to the node
    // ASSUMPTION: if this node is new, it should have a
    //             greater id as its neighbor
    for (const neighbor of node.neighbors) {
      if (neighbor.id < node.id) {
        this.edgesBuffer.push(neighbor.position.concat(node.position));
      }
    }

    this.updateGeometries();
  }


  addNodes(nodeList) {
    nodeList.forEach(node =>
      this.addNode(node));
  }


  deleteNode(node) {
    let edgesIndex;
    let found;
    const swapLast = (array, index) => {
      const lastElement = array.pop();
      Utils.__range__(0, array.elementLength, false).forEach((i) => {
        array.getAllElements()[(index * array.elementLength) + i] = lastElement[i];
      });
    };

    const nodesIndex = this.getNodeIndex(node.id);
    ErrorHandling.assert((nodesIndex != null), "No node found.", { id: node.id, nodeIDs: this.nodeIDs });

    // swap IDs and nodes
    swapLast(this.nodeIDs, nodesIndex);
    swapLast(this.nodesBuffer, nodesIndex);
    swapLast(this.sizesBuffer, nodesIndex);
    swapLast(this.scalesBuffer, nodesIndex);
    swapLast(this.nodesColorBuffer, nodesIndex);

    // Delete Edge by finding it in the array
    const edgeArray = this.getEdgeArray(node, node.neighbors[0]);

    for (const i of Utils.__range__(0, this.edgesBuffer.getLength(), false)) {
      found = true;
      for (let j = 0; j <= 5; j++) {
        found = found && Math.abs(this.edges.geometry.attributes.position.array[(6 * i) + j] - edgeArray[j]) < 0.5;
      }
      if (found) {
        edgesIndex = i;
        break;
      }
    }

    ErrorHandling.assert(found, "No edge found.", { found, edgeArray, nodesIndex });

    swapLast(this.edgesBuffer, edgesIndex);

    this.updateGeometries();
  }

  mergeTree(otherTree, lastNode, activeNode) {
    const merge = (bufferA, bufferB) => {
      bufferA.pushSubarray(bufferB.getAllElements());
    };

    // merge IDs, nodes and edges
    merge(this.nodeIDs, otherTree.nodeIDs);
    merge(this.nodesBuffer, otherTree.nodesBuffer);
    merge(this.edgesBuffer, otherTree.edgesBuffer);
    merge(this.sizesBuffer, otherTree.sizesBuffer);
    merge(this.scalesBuffer, otherTree.scalesBuffer);
    this.edgesBuffer.push(this.getEdgeArray(lastNode, activeNode));

    this.updateNodesColors();
    this.updateGeometries();
  }


  getEdgeArray(node1, node2) {
    // ASSUMPTION: edges always go from smaller ID to bigger ID

    if (node1.id < node2.id) {
      return node1.position.concat(node2.position);
    } else {
      return node2.position.concat(node1.position);
    }
  }


  setSizeAttenuation(sizeAttenuation) {
    this.nodes.material.sizeAttenuation = sizeAttenuation;
    this.updateGeometries();
  }


  updateTreeColor() {
    const newColor = this.model.skeletonTracing.getTree(this.id).color;
    this.edges.material.color = new THREE.Color(this.darkenHex(newColor));

    this.updateNodesColors();
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


  updateNodesColors() {
    this.nodesColorBuffer.clear();
    for (const i of Utils.__range__(0, this.nodeIDs.length, false)) {
      this.nodesColorBuffer.push(this.getColor(this.nodeIDs.get(i)));
    }

    this.updateGeometries();
  }


  updateNodeColor(id, isActiveNode, isBranchPoint) {
    this.doWithNodeIndex(id, index => this.nodesColorBuffer.set(this.getColor(id, isActiveNode, isBranchPoint), index),
    );

    this.updateGeometries();
  }


  updateNodeRadius(id, radius) {
    this.doWithNodeIndex(id, index => this.sizesBuffer.set([radius * 2], index),
    );

    this.updateGeometries();
  }


  startNodeHighlightAnimation(nodeId) {
    const normal = 1.0;
    const highlighted = 2.0;

    this.doWithNodeIndex(nodeId, index => this.animateNodeScale(normal, highlighted, index, () => this.animateNodeScale(highlighted, normal, index),
      ),
    );
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
    const tree = this.model.skeletonTracing.getTree(this.id);
    let { color } = tree;
    if (id != null) {
      isActiveNode = isActiveNode || this.model.skeletonTracing.getActiveNodeId() === id;
      isBranchPoint = isBranchPoint || tree.isBranchPoint(id);

      if (isActiveNode) {
        color = this.shiftHex(color, 1 / 4);
      } else {
        color = this.darkenHex(color);
      }

      if (isBranchPoint) {
        color = this.invertHex(color);
      }
    }

    return this.hexToRGB(color);
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


  logState(title) {
    console.log(` +++ ${title} +++ `);
    console.log("nodeIDs", this.nodeIDs.toString());
    console.log("nodesBuffer", this.nodesBuffer.toString());
    console.log("edgesBuffer", this.edgesBuffer.toString());
    console.log("sizesBuffer", this.sizesBuffer.toString());
  }


  getNodeIndex(nodeId) {
    for (let i = 0; i < this.nodeIDs.length; i++) {
      if (this.nodeIDs.get(i) === nodeId) {
        return i;
      }
    }
    return null;
  }


  doWithNodeIndex(nodeId, f) {
    const index = this.getNodeIndex(nodeId);
    if (index == null) { return; }
    f(index);
  }


  getLineWidth() {
    return this.model.user.get("particleSize") / 4;
  }


  // ### Color utility methods

  hexToRGB(hexColor) {
    const rgbColor = new THREE.Color().setHex(hexColor);
    return [rgbColor.r, rgbColor.g, rgbColor.b];
  }


  darkenHex(hexColor) {
    const hslColor = new THREE.Color(hexColor).getHSL();
    hslColor.l = 0.25;
    return new THREE.Color().setHSL(hslColor.h, hslColor.s, hslColor.l).getHex();
  }


  shiftHex(hexColor, shiftValue) {
    const hslColor = new THREE.Color(hexColor).getHSL();
    hslColor.h = (hslColor.h + shiftValue) % 1;
    return new THREE.Color().setHSL(hslColor.h, hslColor.s, hslColor.l).getHex();
  }


  invertHex(hexColor) {
    return this.shiftHex(hexColor, 0.5);
  }
}

export default Tree;
