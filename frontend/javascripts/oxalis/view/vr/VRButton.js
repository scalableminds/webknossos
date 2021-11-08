// @flow
/**
 * @author mrdoob / http://mrdoob.com
 * @author Mugen87 / https://github.com/Mugen87
 *
 * Based on @tojiro's vr-samples-utils.js
 *
 */
import * as THREE from "three";

function BoxLineGeometry(width, height, depth, widthSegments, heightSegments, depthSegments) {
  THREE.BufferGeometry.call(this);

  width = width || 1;
  height = height || 1;
  depth = depth || 1;

  widthSegments = Math.floor(widthSegments) || 1;
  heightSegments = Math.floor(heightSegments) || 1;
  depthSegments = Math.floor(depthSegments) || 1;

  const widthHalf = width / 2;
  const heightHalf = height / 2;
  const depthHalf = depth / 2;

  const segmentWidth = width / widthSegments;
  const segmentHeight = height / heightSegments;
  const segmentDepth = depth / depthSegments;

  const vertices = [];

  let x = -widthHalf;
  let y = -heightHalf;
  let z = -depthHalf;

  for (let i = 0; i <= widthSegments; i++) {
    vertices.push(x, -heightHalf, -depthHalf, x, heightHalf, -depthHalf);
    vertices.push(x, heightHalf, -depthHalf, x, heightHalf, depthHalf);
    vertices.push(x, heightHalf, depthHalf, x, -heightHalf, depthHalf);
    vertices.push(x, -heightHalf, depthHalf, x, -heightHalf, -depthHalf);

    x += segmentWidth;
  }

  for (let i = 0; i <= heightSegments; i++) {
    vertices.push(-widthHalf, y, -depthHalf, widthHalf, y, -depthHalf);
    vertices.push(widthHalf, y, -depthHalf, widthHalf, y, depthHalf);
    vertices.push(widthHalf, y, depthHalf, -widthHalf, y, depthHalf);
    vertices.push(-widthHalf, y, depthHalf, -widthHalf, y, -depthHalf);

    y += segmentHeight;
  }

  for (let i = 0; i <= depthSegments; i++) {
    vertices.push(-widthHalf, -heightHalf, z, -widthHalf, heightHalf, z);
    vertices.push(-widthHalf, heightHalf, z, widthHalf, heightHalf, z);
    vertices.push(widthHalf, heightHalf, z, widthHalf, -heightHalf, z);
    vertices.push(widthHalf, -heightHalf, z, -widthHalf, -heightHalf, z);

    z += segmentDepth;
  }

  this.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
}

BoxLineGeometry.prototype = Object.create(THREE.BufferGeometry.prototype);
BoxLineGeometry.prototype.constructor = BoxLineGeometry;

export function createVRButton(renderer, options, onEnterFunction) {
  if (options && options.referenceSpaceType) {
    renderer.vr.setReferenceSpaceType(options.referenceSpaceType);
  }

  function showEnterVR(device) {
    button.style.display = "";

    button.style.cursor = "pointer";
    button.style.left = "calc(50% - 50px)";
    button.style.width = "100px";

    button.textContent = "ENTER VR";

    button.onmouseenter = function() {
      button.style.opacity = "1.0";
    };

    button.onmouseleave = function() {
      button.style.opacity = "0.5";
    };

    button.onclick = function() {
      if (device.isPresenting) {
        device.exitPresent();
      } else {
        onEnterFunction();
        console.log("starting vr");
      }
    };

    renderer.vr.setDevice(device);
  }

  function showEnterXR(/*device*/) {
    let currentSession = null;

    function onSessionStarted(session) {
      session.addEventListener("end", onSessionEnded);

      renderer.vr.setSession(session);
      button.textContent = "EXIT XR";

      currentSession = session;
    }

    function onSessionEnded(/*event*/) {
      currentSession.removeEventListener("end", onSessionEnded);

      renderer.vr.setSession(null);
      button.textContent = "ENTER XR";

      currentSession = null;
    }

    //

    button.style.display = "";

    button.style.cursor = "pointer";
    button.style.left = "calc(50% - 50px)";
    button.style.width = "100px";

    button.textContent = "ENTER XR";

    button.onmouseenter = function() {
      button.style.opacity = "1.0";
    };

    button.onmouseleave = function() {
      button.style.opacity = "0.5";
    };

    button.onclick = function() {
      if (currentSession === null) {
        // WebXR's requestReferenceSpace only works if the corresponding feature
        // was requested at session creation time. For simplicity, just ask for
        // the interesting ones as optional features, but be aware that the
        // requestReferenceSpace call will fail if it turns out to be unavailable.
        // ('local' is always available for immersive sessions and doesn't need to
        // be requested separately.)

        const sessionInit = { optionalFeatures: ["local-floor", "bounded-floor"] };
        navigator.xr.requestSession("immersive-vr", sessionInit).then(session => {
          onSessionStarted(session);
          console.log("starting vr");
          onEnterFunction();
        });
      } else {
        currentSession.end();
      }
    };
  }

  function disableButton() {
    button.style.display = "";

    button.style.cursor = "auto";
    button.style.left = "calc(50% - 75px)";
    button.style.width = "150px";

    button.onmouseenter = null;
    button.onmouseleave = null;

    button.onclick = null;
  }

  function showVRNotFound() {
    disableButton();

    button.textContent = "VR NOT FOUND";

    renderer.vr.setDevice(null);
  }

  function showXRNotFound() {
    disableButton();

    button.textContent = "XR NOT FOUND";
  }

  function stylizeElement(element) {
    element.style.position = "absolute";
    element.style.bottom = "20px";
    element.style.padding = "12px 6px";
    element.style.border = "1px solid #fff";
    element.style.borderRadius = "4px";
    element.style.background = "rgba(0,0,0,0.1)";
    element.style.color = "#fff";
    element.style.font = "normal 13px sans-serif";
    element.style.textAlign = "center";
    element.style.opacity = "0.5";
    element.style.outline = "none";
    element.style.zIndex = "999";
  }

  if ("xr" in navigator && "isSessionSupported" in navigator.xr) {
    var button = document.createElement("button");
    button.style.display = "none";

    stylizeElement(button);

    navigator.xr.isSessionSupported("immersive-vr").then(supported => {
      if (supported) {
        showEnterXR();
      } else {
        showXRNotFound();
      }
    });

    return button;
  } else if ("getVRDisplays" in navigator) {
    var button = document.createElement("button");
    button.style.display = "none";

    stylizeElement(button);

    window.addEventListener(
      "vrdisplayconnect",
      event => {
        showEnterVR(event.display);
      },
      false,
    );

    window.addEventListener(
      "vrdisplaydisconnect",
      (/*event*/) => {
        showVRNotFound();
      },
      false,
    );

    window.addEventListener(
      "vrdisplaypresentchange",
      event => {
        button.textContent = event.display.isPresenting ? "EXIT VR" : "ENTER VR";
      },
      false,
    );

    window.addEventListener(
      "vrdisplayactivate",
      event => {
        event.display.requestPresent([{ source: renderer.domElement }]);
      },
      false,
    );

    navigator
      .getVRDisplays()
      .then(displays => {
        if (displays.length > 0) {
          showEnterVR(displays[0]);
        } else {
          showVRNotFound();
        }
      })
      .catch(showVRNotFound);

    return button;
  } else {
    const message = document.createElement("a");
    message.href = "https://webvr.info";
    message.innerHTML = "WEBVR NOT SUPPORTED";

    message.style.left = "calc(50% - 90px)";
    message.style.width = "180px";
    message.style.textDecoration = "none";

    stylizeElement(message);

    return message;
  }
}

export class VRSession {
  geometry;
  renderer;
  normal;
  camera;
  room;
  scene;
  light;
  count = 0;
  clock = new THREE.Clock();
  radius = 0.08;
  normal = new THREE.Vector3();
  relativeVelocity = new THREE.Vector3();

  constructor() {
    // const btn = WEBVR.createButton( getSceneController().renderer );
    // console.log(btn);  // Just to make sure it's being generated

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
    });
    /*renderer.setAnimationLoop( function () {
      renderer.render( scene, camera )
    } );*/

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x509050);

    this.geometry = new THREE.IcosahedronBufferGeometry(this.radius, 2);
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 10);

    this.room = new THREE.LineSegments(
      new BoxLineGeometry(6, 6, 6, 10, 10, 10),
      new THREE.LineBasicMaterial({ color: 0x808080 }),
    );
    this.room.geometry.translate(0, 3, 0);
    this.scene.add(this.room);

    this.light = new THREE.HemisphereLight(0xffffff, 0x444444);
    this.light.position.set(1, 1, 1);
    this.scene.add(this.light);

    for (let i = 0; i < 200; i++) {
      const object = new THREE.Mesh(
        this.geometry,
        new THREE.MeshLambertMaterial({ color: Math.random() * 0xffffff }),
      );

      object.position.x = Math.random() * 4 - 2;
      object.position.y = Math.random() * 4;
      object.position.z = Math.random() * 4 - 2;

      object.userData.velocity = new THREE.Vector3();
      object.userData.velocity.x = Math.random() * 0.01 - 0.005;
      object.userData.velocity.y = Math.random() * 0.01 - 0.005;
      object.userData.velocity.z = Math.random() * 0.01 - 0.005;

      this.room.add(object);
    }

    //

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.vr.enabled = true;
    document.body.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.left = "0px";
    this.renderer.domElement.style.top = "0px";

    //

    document.body.appendChild(createVRButton(this.renderer));

    // controllers

    this.controller1 = this.renderer.vr.getController(0);
    this.controller1.addEventListener("selectstart", this.onSelectStart);
    this.controller1.addEventListener("selectend", this.onSelectEnd);
    this.scene.add(this.controller1);

    this.controller2 = this.renderer.vr.getController(1);
    this.controller2.addEventListener("selectstart", this.onSelectStart);
    this.controller2.addEventListener("selectend", this.onSelectEnd);
    this.scene.add(this.controller2);

    // helpers

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3),
    );
    this.geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute([0.5, 0.5, 0.5, 0, 0, 0], 3),
    );

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    });

    this.controller1.add(new THREE.Line(this.geometry, material));
    this.controller2.add(new THREE.Line(this.geometry, material));

    //

    window.addEventListener("resize", this.onWindowResize, false);

    //

    this.animate();
  }

  animate = () => {
    this.renderer.setAnimationLoop(this.render);
  };

  /* renderer.setAnimationLoop(() => {
      renderer.render(sceneController.scene, this.cameras[OrthoViews.TDView]);
    });*/

  onWindowResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  handleController = controller => {
    if (controller.userData.isSelecting) {
      const object = this.room.children[this.count++];

      object.position.copy(controller.position);
      object.userData.velocity.x = (Math.random() - 0.5) * 3;
      object.userData.velocity.y = (Math.random() - 0.5) * 3;
      object.userData.velocity.z = Math.random() - 9;
      object.userData.velocity.applyQuaternion(controller.quaternion);

      if (this.count === this.room.children.length) this.count = 0;
    }
  };

  render = () => {
    this.handleController(this.controller1);
    this.handleController(this.controller2);

    //

    const delta = this.clock.getDelta() * 0.8; // slow down simulation

    const range = 3 - this.radius;

    for (let i = 0; i < this.room.children.length; i++) {
      const object = this.room.children[i];

      object.position.x += object.userData.velocity.x * delta;
      object.position.y += object.userData.velocity.y * delta;
      object.position.z += object.userData.velocity.z * delta;

      // keep objects inside room

      if (object.position.x < -range || object.position.x > range) {
        object.position.x = THREE.Math.clamp(object.position.x, -range, range);
        object.userData.velocity.x = -object.userData.velocity.x;
      }

      if (object.position.y < this.radius || object.position.y > 6) {
        object.position.y = Math.max(object.position.y, this.radius);

        object.userData.velocity.x *= 0.98;
        object.userData.velocity.y = -object.userData.velocity.y * 0.8;
        object.userData.velocity.z *= 0.98;
      }

      if (object.position.z < -range || object.position.z > range) {
        object.position.z = THREE.Math.clamp(object.position.z, -range, range);
        object.userData.velocity.z = -object.userData.velocity.z;
      }

      for (let j = i + 1; j < this.room.children.length; j++) {
        const object2 = this.room.children[j];

        this.normal.copy(object.position).sub(object2.position);

        const distance = this.normal.length();

        if (distance < 2 * this.radius) {
          this.normal.multiplyScalar(0.5 * distance - this.radius);

          object.position.sub(this.normal);
          object2.position.add(this.normal);

          this.normal.normalize();

          this.relativeVelocity.copy(object.userData.velocity).sub(object2.userData.velocity);

          this.normal = this.normal.multiplyScalar(this.relativeVelocity.dot(this.normal));

          object.userData.velocity.sub(this.normal);
          object2.userData.velocity.add(this.normal);
        }
      }

      object.userData.velocity.y -= 9.8 * delta;
    }

    this.renderer.render(this.scene, this.camera);
  };

  onSelectStart = () => {
    this.userData.isSelecting = true;
  };

  onSelectEnd = () => {
    this.userData.isSelecting = false;
  };
}
