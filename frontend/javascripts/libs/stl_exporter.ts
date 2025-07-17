/* eslint-disable */
import { Scene, BufferGeometry, Vector3 } from "three";

// Original Source: https://github.com/mrdoob/three.js/blob/master/examples/js/exporters/STLExporter.js
// Manual changes:
// - the `exportToStl` function was added as a wrapper
// - the `parse` method was adapted to emit multiple ArrayBuffers
//   to avoid that one large ArrayBuffer has to be allocated (which can
//   fail if not enough consecutive memory is available).
//   (see https://github.com/scalableminds/webknossos/pull/7074.)

class ChunkedDataView {
  views: DataView[];
  offset: number;

  constructor(initialBufferLength: number) {
    this.views = [];
    this.startNewChunk(initialBufferLength);
    this.offset = 0;
  }

  get currentDataView() {
    return this.views[this.views.length - 1];
  }

  incrementOffset(n: number) {
    this.offset += n;
  }

  startNewChunk(newBufferLength: number) {
    this.views.push(new DataView(new ArrayBuffer(newBufferLength)));
    this.offset = 0;
  }
}

class STLExporter {
  parse(scene: Scene, options: any = {}) {
    const binary = options.binary !== undefined ? options.binary : false; //

    const objects: any[] = [];
    let triangles = 0;
    scene.traverse(function (object: any) {
      if (object.isMesh) {
        const geometry = object.geometry;

        if (geometry.isBufferGeometry !== true) {
          throw new Error("STLExporter: Geometry is not of type THREE.BufferGeometry.");
        }

        const index = geometry.index;
        const positionAttribute = geometry.getAttribute("position");
        triangles += index !== null ? index.count / 3 : positionAttribute.count / 3;
        objects.push({
          object3d: object,
          geometry: geometry,
        });
      }
    });
    let outputString: string = "";
    let remainingTriangles = triangles;
    const emptyHeaderSize = 80;
    const output = new ChunkedDataView(emptyHeaderSize + 4);
    output.incrementOffset(emptyHeaderSize);

    // Per triangle, the following bytes are written:
    // - 1 Uint16 (2 B) for the attribute byte count
    // - 3 Float32 (3 * 4 B) for the triangle normal
    // - 3 vertices à 3 Float32 (3 * 3 * 4 B)
    const bytesPerTriangle = 2 + 3 * 4 + 3 * 3 * 4; //  50
    const maximumBatchSizeInMiB = 50;
    const maximumBatchSizeInB = 2 ** 20 * maximumBatchSizeInMiB;
    const maximumTriangleCountPerBatch = Math.ceil(maximumBatchSizeInB / bytesPerTriangle);

    if (binary === true) {
      output.currentDataView.setUint32(output.offset, triangles, true);
      output.incrementOffset(4);
      const triangleCountForNewChunk = Math.min(remainingTriangles, maximumTriangleCountPerBatch);
      remainingTriangles -= triangleCountForNewChunk;
      output.startNewChunk(bytesPerTriangle * triangleCountForNewChunk);
    } else {
      outputString = "";
      outputString += "solid exported\n";
    }

    const vA = new Vector3();
    const vB = new Vector3();
    const vC = new Vector3();
    const cb = new Vector3();
    const ab = new Vector3();
    const normal = new Vector3();

    for (let i = 0, il = objects.length; i < il; i++) {
      const object = objects[i].object3d;
      const geometry = objects[i].geometry;
      const index = geometry.index;
      const positionAttribute = geometry.getAttribute("position");

      if (index !== null) {
        // indexed geometry
        for (let j = 0; j < index.count; j += 3) {
          const a = index.getX(j + 0);
          const b = index.getX(j + 1);
          const c = index.getX(j + 2);
          writeFace(a, b, c, positionAttribute, object);
        }
      } else {
        // non-indexed geometry
        for (let j = 0; j < positionAttribute.count; j += 3) {
          const a = j + 0;
          const b = j + 1;
          const c = j + 2;
          writeFace(a, b, c, positionAttribute, object);
        }
      }
    }

    if (binary === false) {
      outputString += "endsolid exported\n";
    }

    return binary ? output.views : outputString;

    function writeFace(a: any, b: any, c: any, positionAttribute: any, object: any) {
      vA.fromBufferAttribute(positionAttribute, a);
      vB.fromBufferAttribute(positionAttribute, b);
      vC.fromBufferAttribute(positionAttribute, c);

      if (object.isSkinnedMesh === true) {
        object.boneTransform(a, vA);
        object.boneTransform(b, vB);
        object.boneTransform(c, vC);
      }

      vA.applyMatrix4(object.matrixWorld);
      vB.applyMatrix4(object.matrixWorld);
      vC.applyMatrix4(object.matrixWorld);
      writeNormal(vA, vB, vC);
      writeVertex(vA);
      writeVertex(vB);
      writeVertex(vC);

      if (binary === true) {
        // Set attribute byte count to 0
        output.currentDataView.setUint16(output.offset, 0, true);
        output.incrementOffset(2);
      } else {
        outputString += "\t\tendloop\n";
        outputString += "\tendfacet\n";
      }

      if (output.offset === output.currentDataView.byteLength && remainingTriangles > 0) {
        const triangleCountForNewChunk = Math.min(remainingTriangles, maximumTriangleCountPerBatch);
        remainingTriangles -= triangleCountForNewChunk;

        output.startNewChunk(bytesPerTriangle * triangleCountForNewChunk);
      }
    }

    function writeNormal(vA: any, vB: any, vC: any) {
      cb.subVectors(vC, vB);
      ab.subVectors(vA, vB);
      cb.cross(ab).normalize();
      normal.copy(cb).normalize();

      if (binary === true) {
        output.currentDataView.setFloat32(output.offset, normal.x, true);
        output.incrementOffset(4);
        output.currentDataView.setFloat32(output.offset, normal.y, true);
        output.incrementOffset(4);
        output.currentDataView.setFloat32(output.offset, normal.z, true);
        output.incrementOffset(4);
      } else {
        outputString += "\tfacet normal " + normal.x + " " + normal.y + " " + normal.z + "\n";
        outputString += "\t\touter loop\n";
      }
    }

    function writeVertex(vertex: any) {
      if (binary === true) {
        output.currentDataView.setFloat32(output.offset, vertex.x, true);
        output.incrementOffset(4);
        output.currentDataView.setFloat32(output.offset, vertex.y, true);
        output.incrementOffset(4);
        output.currentDataView.setFloat32(output.offset, vertex.z, true);
        output.incrementOffset(4);
      } else {
        outputString += "\t\t\tvertex " + vertex.x + " " + vertex.y + " " + vertex.z + "\n";
      }
    }
  }
}

export default function exportToStl(mesh: any): DataView[] {
  const exporter = new STLExporter();
  const dataViews = exporter.parse(mesh, {
    binary: true,
  }) as DataView[];
  return dataViews;
}
