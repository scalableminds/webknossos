import THREE from "three";
import ColorGenerator from "libs/color_generator";

class VolumeGeometry {


  constructor(triangles, id) {
    this.id = id;
    const geo = new THREE.Geometry();
    const color = ColorGenerator.distinctColorForId(this.id % 256);

    let i = 0;
    for (const triangle of triangles) {
      for (const vertex of triangle) {
        geo.vertices.push(new THREE.Vector3(...vertex));
      }
      const normal = this.getTriangleNormal(triangle);
      geo.faces.push(new THREE.Face3(i++, i++, i++, normal));
    }

    this.mesh = new THREE.Mesh(geo,
      new THREE.MeshPhongMaterial({
        color,
      }));
    this.mesh.oberdraw = true;
  }


  getTriangleNormal(triangle) {
    const v1 = new THREE.Vector3(triangle[1][0] - triangle[0][0],
                            triangle[1][1] - triangle[0][1],
                            triangle[1][2] - triangle[0][2]);

    const v2 = new THREE.Vector3(triangle[2][0] - triangle[0][0],
                            triangle[2][1] - triangle[0][1],
                            triangle[2][2] - triangle[0][2]);

    v1.cross(v2);
    v1.normalize();
    return v1;
  }


  getMeshes() {
    return [this.mesh];
  }
}


export default VolumeGeometry;
