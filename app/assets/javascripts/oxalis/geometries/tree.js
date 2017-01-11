import app from "app";
import Utils from "libs/utils";
import ResizableBuffer from "libs/resizable_buffer";
import ErrorHandling from "libs/error_handling";
import THREE from "three";
import TWEEN from "tween.js";
import ColorConverter from "three.color";
import ParticleMaterialFactory from "./materials/particle_material_factory";

class Tree {

  constructor(treeId, treeColor, model) {
    // create skeletonTracing to show in TDView and pre-allocate buffers

    this.model = model;
    const edgeGeometry = new THREE.BufferGeometry();
    const nodeGeometry = new THREE.BufferGeometry();

    edgeGeometry.addAttribute("position", Float32Array, 0, 3);
    nodeGeometry.addAttribute("position", Float32Array, 0, 3);
    nodeGeometry.addAttribute("sizeNm", Float32Array, 0, 1);
    nodeGeometry.addAttribute("nodeScaleFactor", Float32Array, 0, 1);
    nodeGeometry.addAttribute("color", Float32Array, 0, 3);

    this.nodeIDs = nodeGeometry.nodeIDs = new ResizableBuffer(1, 100, Int32Array);
    edgeGeometry.dynamic = true;
    nodeGeometry.dynamic = true;

    this.edgesBuffer = edgeGeometry.attributes.position.rBuffer = new ResizableBuffer(6);
    this.nodesBuffer = nodeGeometry.attributes.position.rBuffer = new ResizableBuffer(3);
    this.sizesBuffer = nodeGeometry.attributes.sizeNm.rBuffer = new ResizableBuffer(1);
    this.scalesBuffer = nodeGeometry.attributes.nodeScaleFactor.rBuffer = new ResizableBuffer(1);
    this.nodesColorBuffer = nodeGeometry.attributes.color.rBuffer = new ResizableBuffer(3);

    this.edges = new THREE.Line(
      edgeGeometry,
      new THREE.LineBasicMaterial({
        color: this.darkenHex(treeColor),
        linewidth: this.getLineWidth() }),
      THREE.LinePieces,
    );

    this.particleMaterial = new ParticleMaterialFactory(this.model).getMaterial();
    this.nodes = new THREE.ParticleSystem(nodeGeometry, this.particleMaterial);

    this.id = treeId;
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
    this.nodesBuffer.push(node.pos);
    this.sizesBuffer.push([node.radius * 2]);
    this.scalesBuffer.push([1.0]);
    this.nodeIDs.push([node.id]);
    this.nodesColorBuffer.push(this.getColor(node.id));

    // Add any edge from smaller IDs to the node
    // ASSUMPTION: if this node is new, it should have a
    //             greater id as its neighbor
    for (const neighbor of node.neighbors) {
      if (neighbor.id < node.id) {
        this.edgesBuffer.push(neighbor.pos.concat(node.pos));
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
        found &= Math.abs(this.edges.geometry.attributes.position.array[(6 * i) + j] - edgeArray[j]) < 0.5;
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
    const merge = property => this[property].pushSubarray(otherTree[property].getAllElements());

    // merge IDs, nodes and edges
    merge("nodeIDs");
    merge("nodesBuffer");
    merge("edgesBuffer");
    merge("sizesBuffer");
    merge("scalesBuffer");
    this.edgesBuffer.push(this.getEdgeArray(lastNode, activeNode));

    this.updateNodesColors();
    this.updateGeometries();
  }


  getEdgeArray(node1, node2) {
    // ASSUMPTION: edges always go from smaller ID to bigger ID

    if (node1.id < node2.id) {
      return node1.pos.concat(node2.pos);
    } else {
      return node2.pos.concat(node1.pos);
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
    return [this.edges, this.nodes];
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
    return [this.edges, this.nodes].map(mesh =>
      (() => {
        const result = [];
        for (const attr of Object.keys(mesh.geometry.attributes)) {
          const a = mesh.geometry.attributes[attr];
          a.array = a.rBuffer.getBuffer();
          a.numItems = a.rBuffer.getBufferLength();
          result.push(a.needsUpdate = true);
        }
        return result;
      })());
  }


  logState(title) {
    console.log(` +++ ${title} +++ `);
    console.log("nodeIDs", this.nodeIDs.toString());
    console.log("nodesBuffer", this.nodesBuffer.toString());
    console.log("edgesBuffer", this.edgesBuffer.toString());
    console.log("sizesBuffer", this.sizesBuffer.toString());
  }


  getNodeIndex(nodeId) {
    for (const i of Utils.__range__(0, this.nodeIDs.length, true)) {
      if (this.nodeIDs.get(i) === nodeId) {
        return i;
      }
    }
  }


  doWithNodeIndex(nodeId, f) {
    const index = this.getNodeIndex(nodeId);
    if (index == null) { return; }
    return f(index);
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
    const hsvColor = ColorConverter.getHSV(new THREE.Color().setHex(hexColor));
    hsvColor.v = 0.6;
    return ColorConverter.setHSV(new THREE.Color(), hsvColor.h, hsvColor.s, hsvColor.v).getHex();
  }


  shiftHex(hexColor, shiftValue) {
    const hsvColor = ColorConverter.getHSV(new THREE.Color().setHex(hexColor));
    hsvColor.h = (hsvColor.h + shiftValue) % 1;
    return ColorConverter.setHSV(new THREE.Color(), hsvColor.h, hsvColor.s, hsvColor.v).getHex();
  }


  invertHex(hexColor) {
    return this.shiftHex(hexColor, 0.5);
  }
}

export default Tree;
