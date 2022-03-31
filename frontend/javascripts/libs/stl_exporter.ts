// @noflow

/* eslint-disable eslint-comments/no-unlimited-disable */

/* eslint-disable */
import * as THREE from "three";

// Original Source: https://github.com/mrdoob/three.js/blob/master/examples/js/exporters/STLExporter.js
// Only the `exportToStl` function was added as a wrapper.

/**
 * @author kovacsv / http://kovacsv.hu/
 * @author mrdoob / http://mrdoob.com/
 * @author mudcube / http://mudcu.be/
 * @author Mugen87 / https://github.com/Mugen87
 *
 * Usage:
 *  var exporter = new THREE.STLExporter();
 *
 *  // second argument is a list of options
 *  var data = exporter.parse( mesh, { binary: true } );
 *
 */
// @ts-expect-error ts-migrate(2339) FIXME: Property 'STLExporter' does not exist on type 'typ... Remove this comment to see the full error message
THREE.STLExporter = function () {};

// @ts-expect-error ts-migrate(2339) FIXME: Property 'STLExporter' does not exist on type 'typ... Remove this comment to see the full error message
THREE.STLExporter.prototype = {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'STLExporter' does not exist on type 'typ... Remove this comment to see the full error message
  constructor: THREE.STLExporter,
  parse: (function () {
    var vector = new THREE.Vector3();
    var normalMatrixWorld = new THREE.Matrix3();
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'scene' implicitly has an 'any' type.
    return function parse(scene, options) {
      if (options === undefined) options = {};
      var binary = options.binary !== undefined ? options.binary : false;
      // @ts-expect-error ts-migrate(7034) FIXME: Variable 'objects' implicitly has type 'any[]' in ... Remove this comment to see the full error message
      var objects = [];
      var triangles = 0;
      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'object' implicitly has an 'any' type.
      scene.traverse(function (object) {
        if (object.isMesh) {
          var geometry = object.geometry;

          if (geometry.isBufferGeometry) {
            geometry = new THREE.Geometry().fromBufferGeometry(geometry);
          }

          if (geometry.isGeometry) {
            triangles += geometry.faces.length;
            objects.push({
              geometry: geometry,
              matrixWorld: object.matrixWorld,
            });
          }
        }
      });

      if (binary) {
        var offset = 80; // skip header

        var bufferLength = triangles * 2 + triangles * 3 * 4 * 4 + 80 + 4;
        var arrayBuffer = new ArrayBuffer(bufferLength);
        var output = new DataView(arrayBuffer);
        output.setUint32(offset, triangles, true);
        offset += 4;

        for (var i = 0, il = objects.length; i < il; i++) {
          // @ts-expect-error ts-migrate(7005) FIXME: Variable 'objects' implicitly has an 'any[]' type.
          var object = objects[i];
          var vertices = object.geometry.vertices;
          var faces = object.geometry.faces;
          var matrixWorld = object.matrixWorld;
          normalMatrixWorld.getNormalMatrix(matrixWorld);

          for (var j = 0, jl = faces.length; j < jl; j++) {
            var face = faces[j];
            vector.copy(face.normal).applyMatrix3(normalMatrixWorld).normalize();
            output.setFloat32(offset, vector.x, true);
            offset += 4; // normal

            output.setFloat32(offset, vector.y, true);
            offset += 4;
            output.setFloat32(offset, vector.z, true);
            offset += 4;
            var indices = [face.a, face.b, face.c];

            for (var k = 0; k < 3; k++) {
              vector.copy(vertices[indices[k]]).applyMatrix4(matrixWorld);
              output.setFloat32(offset, vector.x, true);
              offset += 4; // vertices

              output.setFloat32(offset, vector.y, true);
              offset += 4;
              output.setFloat32(offset, vector.z, true);
              offset += 4;
            }

            output.setUint16(offset, 0, true);
            offset += 2; // attribute byte count
          }
        }

        return output;
      } else {
        // @ts-expect-error ts-migrate(2403) FIXME: Subsequent variable declarations must have the sam... Remove this comment to see the full error message
        var output = "";
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'DataView'... Remove this comment to see the full error message
        output += "solid exported\n";

        for (var i = 0, il = objects.length; i < il; i++) {
          // @ts-expect-error ts-migrate(7005) FIXME: Variable 'objects' implicitly has an 'any[]' type.
          var object = objects[i];
          var vertices = object.geometry.vertices;
          var faces = object.geometry.faces;
          var matrixWorld = object.matrixWorld;
          normalMatrixWorld.getNormalMatrix(matrixWorld);

          for (var j = 0, jl = faces.length; j < jl; j++) {
            var face = faces[j];
            vector.copy(face.normal).applyMatrix3(normalMatrixWorld).normalize();
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'DataView'... Remove this comment to see the full error message
            output += "\tfacet normal " + vector.x + " " + vector.y + " " + vector.z + "\n";
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'DataView'... Remove this comment to see the full error message
            output += "\t\touter loop\n";
            var indices = [face.a, face.b, face.c];

            for (var k = 0; k < 3; k++) {
              vector.copy(vertices[indices[k]]).applyMatrix4(matrixWorld);
              // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'DataView'... Remove this comment to see the full error message
              output += "\t\t\tvertex " + vector.x + " " + vector.y + " " + vector.z + "\n";
            }

            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'DataView'... Remove this comment to see the full error message
            output += "\t\tendloop\n";
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'DataView'... Remove this comment to see the full error message
            output += "\tendfacet\n";
          }
        }

        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'DataView'... Remove this comment to see the full error message
        output += "endsolid exported\n";
        return output;
      }
    };
  })(),
};
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'mesh' implicitly has an 'any' type.
export default function exportToStl(mesh) {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'STLExporter' does not exist on type 'typ... Remove this comment to see the full error message
  var exporter = new THREE.STLExporter();
  // second argument is a list of options
  var data = exporter.parse(mesh, {
    binary: true,
  });
  return data;
}
