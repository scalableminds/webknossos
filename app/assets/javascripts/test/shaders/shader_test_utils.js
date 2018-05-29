// @flow

const THREE = require("three");
const PNG = require("pngjs").PNG;
import GL from "gl";
import fs from "fs";

const dumpToPng = (gl, width, height) => {
  const path = "out.png";
  const png = new PNG({
    width: width,
    height: height,
  });
  const pixels = new Uint8Array(4 * width * height);

  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  for (let j = 0; 0 <= height ? j < height : j > height; 0 <= height ? j++ : j--) {
    for (let i = 0; 0 <= width ? i < width : i > width; 0 <= width ? i++ : i--) {
      const k = j * width + i;
      const r = pixels[4 * k];
      const g = pixels[4 * k + 1];
      const b = pixels[4 * k + 2];
      const a = pixels[4 * k + 3];
      const m = (height - j - 1) * width + i;
      png.data[4 * m] = r;
      png.data[4 * m + 1] = g;
      png.data[4 * m + 2] = b;
      png.data[4 * m + 3] = a;
    }
  }

  const stream = fs.createWriteStream(path);
  png.pack().pipe(stream);
  stream.on("close", function() {
    return console.log("Image written: " + path);
  });
};

export function renderShader(glslFn, fragColorExpr) {
  const pWidth = 10;
  const width = pWidth;
  const height = pWidth;
  let gl = GL(width, height, { preserveDrawingBuffer: true });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(
    -pWidth / 2,
    pWidth / 2,
    pWidth / 2,
    -pWidth / 2,
    -100,
    100,
  );
  camera.position.copy(new THREE.Vector3(0, 0, -1));
  camera.lookAt(new THREE.Vector3(0, 0, 0));
  camera.updateProjectionMatrix();

  scene.add(camera);
  const canvas = {
    addEventListener: () => {},
  };
  console.log("gl", gl);
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    width: 0,
    height: 0,
    canvas: canvas,
    context: gl,
  });
  const geometry = new THREE.PlaneGeometry(pWidth, pWidth, 1, 1);

  const material = new THREE.ShaderMaterial();
  const color = new THREE.Vector4(1.0, 0.0, 0.0, 1.0);
  material.vertexShader = `
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`;

  material.fragmentShader = `
    uniform vec4 solidColor;

    ${glslFn}

    void main() {
      gl_FragColor = ${fragColorExpr};
    }`;
  material.uniforms = {
    solidColor: {
      type: "v4",
      value: color,
    },
  };

  const plane = new THREE.Mesh(geometry, material);
  plane.position.copy(new THREE.Vector3(0, 0, 0));
  plane.setRotationFromEuler(new THREE.Euler(Math.PI, 0, 0));

  scene.add(plane);
  const rtTexture = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
  });

  console.time("render and read");
  renderer.render(scene, camera, rtTexture, true);

  // dumpToPng(gl, width, height);

  const pixels = new Uint8Array(4 * width * height);

  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  console.timeEnd("render and read");

  return pixels;
}
