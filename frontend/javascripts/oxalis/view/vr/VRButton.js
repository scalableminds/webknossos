// @flow
/**
 * @author mrdoob / http://mrdoob.com
 * @author Mugen87 / https://github.com/Mugen87
 *
 * Based on @tojiro's vr-samples-utils.js
 *
 */
import * as THREE from "three";

const _lookDirection = new THREE.Vector3();

const _spherical = new THREE.Spherical();

const _target = new THREE.Vector3();
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
function degToRad(degrees) {
  return degrees * DEG2RAD;
}
function radToDeg(radians) {
  return radians * RAD2DEG;
}
function mapLinear(x, a1, a2, b1, b2) {
  return b1 + ((x - a1) * (b2 - b1)) / (a2 - a1);
}
class FirstPersonControls {
  constructor(object, domElement) {
    if (domElement === undefined) {
      console.warn(
        'THREE.FirstPersonControls: The second parameter "domElement" is now mandatory.',
      );
      domElement = document;
    }

    this.object = object;
    this.domElement = domElement; // API

    this.enabled = true;
    this.movementSpeed = 1.0;
    this.lookSpeed = 0.005;
    this.lookVertical = true;
    this.autoForward = false;
    this.activeLook = true;
    this.heightSpeed = false;
    this.heightCoef = 1.0;
    this.heightMin = 0.0;
    this.heightMax = 1.0;
    this.constrainVertical = false;
    this.verticalMin = 0;
    this.verticalMax = Math.PI;
    this.mouseDragOn = false; // internals

    this.autoSpeedFactor = 0.0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.moveForward = false;
    this.moveBackward = false;
    this.moveLeft = false;
    this.moveRight = false;
    this.viewHalfX = 0;
    this.viewHalfY = 0; // private variables

    let lat = 0;
    let lon = 0; //

    this.handleResize = function() {
      if (this.domElement === document) {
        this.viewHalfX = window.innerWidth / 2;
        this.viewHalfY = window.innerHeight / 2;
      } else {
        this.viewHalfX = this.domElement.offsetWidth / 2;
        this.viewHalfY = this.domElement.offsetHeight / 2;
      }
    };

    this.onMouseDown = function(event) {
      if (this.domElement !== document) {
        this.domElement.focus();
      }

      if (this.activeLook) {
        switch (event.button) {
          case 0:
            this.moveForward = true;
            break;

          case 2:
            this.moveBackward = true;
            break;
        }
      }

      this.mouseDragOn = true;
    };

    this.onMouseUp = function(event) {
      if (this.activeLook) {
        switch (event.button) {
          case 0:
            this.moveForward = false;
            break;

          case 2:
            this.moveBackward = false;
            break;
        }
      }

      this.mouseDragOn = false;
    };

    this.onMouseMove = function(event) {
      if (this.domElement === document) {
        this.mouseX = event.pageX - this.viewHalfX;
        this.mouseY = event.pageY - this.viewHalfY;
      } else {
        this.mouseX = event.pageX - this.domElement.offsetLeft - this.viewHalfX;
        this.mouseY = event.pageY - this.domElement.offsetTop - this.viewHalfY;
      }
    };

    this.onKeyDown = function(event) {
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          this.moveForward = true;
          break;

        case "ArrowLeft":
        case "KeyA":
          this.moveLeft = true;
          break;

        case "ArrowDown":
        case "KeyS":
          this.moveBackward = true;
          break;

        case "ArrowRight":
        case "KeyD":
          this.moveRight = true;
          break;

        case "KeyR":
          this.moveUp = true;
          break;

        case "KeyF":
          this.moveDown = true;
          break;
      }
    };

    this.onKeyUp = function(event) {
      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          this.moveForward = false;
          break;

        case "ArrowLeft":
        case "KeyA":
          this.moveLeft = false;
          break;

        case "ArrowDown":
        case "KeyS":
          this.moveBackward = false;
          break;

        case "ArrowRight":
        case "KeyD":
          this.moveRight = false;
          break;

        case "KeyR":
          this.moveUp = false;
          break;

        case "KeyF":
          this.moveDown = false;
          break;
      }
    };

    this.lookAt = function(x, y, z) {
      if (x.isVector3) {
        _target.copy(x);
      } else {
        _target.set(x, y, z);
      }

      this.object.lookAt(_target);
      setOrientation(this);
      return this;
    };

    this.update = (function() {
      const targetPosition = new THREE.Vector3();
      return function update(delta) {
        if (this.enabled === false) return;

        if (this.heightSpeed) {
          const y = clamp(this.object.position.y, this.heightMin, this.heightMax);
          const heightDelta = y - this.heightMin;
          this.autoSpeedFactor = delta * (heightDelta * this.heightCoef);
        } else {
          this.autoSpeedFactor = 0.0;
        }

        const actualMoveSpeed = delta * this.movementSpeed;
        if (this.moveForward || (this.autoForward && !this.moveBackward))
          this.object.translateZ(-(actualMoveSpeed + this.autoSpeedFactor));
        if (this.moveBackward) this.object.translateZ(actualMoveSpeed);
        if (this.moveLeft) this.object.translateX(-actualMoveSpeed);
        if (this.moveRight) this.object.translateX(actualMoveSpeed);
        if (this.moveUp) this.object.translateY(actualMoveSpeed);
        if (this.moveDown) this.object.translateY(-actualMoveSpeed);
        let actualLookSpeed = delta * this.lookSpeed;

        if (!this.activeLook) {
          actualLookSpeed = 0;
        }

        let verticalLookRatio = 1;

        if (this.constrainVertical) {
          verticalLookRatio = Math.PI / (this.verticalMax - this.verticalMin);
        }

        lon -= this.mouseX * actualLookSpeed;
        if (this.lookVertical) lat -= this.mouseY * actualLookSpeed * verticalLookRatio;
        lat = Math.max(-85, Math.min(85, lat));
        let phi = degToRad(90 - lat);
        const theta = degToRad(lon);

        if (this.constrainVertical) {
          phi = mapLinear(phi, 0, Math.PI, this.verticalMin, this.verticalMax);
        }

        const position = this.object.position;
        targetPosition.setFromSphericalCoords(1, phi, theta).add(position);
        this.object.lookAt(targetPosition);
      };
    })();

    this.dispose = function() {
      this.domElement.removeEventListener("contextmenu", contextmenu);
      this.domElement.removeEventListener("mousedown", _onMouseDown);
      this.domElement.removeEventListener("mousemove", _onMouseMove);
      this.domElement.removeEventListener("mouseup", _onMouseUp);
      window.removeEventListener("keydown", _onKeyDown);
      window.removeEventListener("keyup", _onKeyUp);
    };

    const _onMouseMove = this.onMouseMove.bind(this);

    const _onMouseDown = this.onMouseDown.bind(this);

    const _onMouseUp = this.onMouseUp.bind(this);

    const _onKeyDown = this.onKeyDown.bind(this);

    const _onKeyUp = this.onKeyUp.bind(this);

    this.domElement.addEventListener("contextmenu", contextmenu);
    this.domElement.addEventListener("mousemove", _onMouseMove);
    this.domElement.addEventListener("mousedown", _onMouseDown);
    this.domElement.addEventListener("mouseup", _onMouseUp);
    window.addEventListener("keydown", _onKeyDown);
    window.addEventListener("keyup", _onKeyUp);

    function setOrientation(controls) {
      const quaternion = controls.object.quaternion;

      _lookDirection.set(0, 0, -1).applyQuaternion(quaternion);

      _spherical.setFromVector3(_lookDirection);

      lat = 90 - radToDeg(_spherical.phi);
      lon = radToDeg(_spherical.theta);
    }

    this.handleResize();
    setOrientation(this);
  }
}

function contextmenu(event) {
  event.preventDefault();
}
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

export function createVRButton(renderer, options) {
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
  controller1;
  ballsGroup;
  controller2;
  movementControl;
  clock = new THREE.Clock();
  radius = 0.08;
  normal = new THREE.Vector3();
  relativeVelocity = new THREE.Vector3();
  rootGroup;
  clock;

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
    this.rootGroup = new THREE.Group();
    this.ballsGroup = new THREE.Group();
    this.scene.add(this.rootGroup);
    this.rootGroup.add(this.ballsGroup);
    this.scene.background = new THREE.Color(0x509050);
    this.clock = new THREE.Clock();
    this.geometry = new THREE.IcosahedronBufferGeometry(this.radius, 2);
    this.camera = new THREE.PerspectiveCamera(
      90,
      window.innerWidth / window.innerHeight,
      0.1,
      1000000,
    );

    /* this.room = new THREE.LineSegments(
      new BoxLineGeometry(6, 6, 6, 10, 10, 10),
      new THREE.LineBasicMaterial({ color: 0x808080 }),
    ); 
    this.room.geometry.translate(0, 3, 0); 
    this.scene.add(this.room); */

    // this.light = new THREE.HemisphereLight(0xffffff, 0x444444);
    this.light = new THREE.AmbientLight(0x404040, 15); // light used in our scene
    //const ambientLightForIsosurfaces = new THREE.AmbientLight(0x404040, 15); // soft white light
    //this.lights.push(ambientLightForIsosurfaces);
    //this.scene.add(ambientLightForIsosurfaces);
    // const ambientLightForMeshes = new THREE.AmbientLight(0x404040, 15); // soft white light
    //this.lights.push(ambientLightForMeshes);
    //this.scene.add(ambientLightForMeshes);
    // this.light.position.set(1, 1, 1);
    this.scene.add(this.light);

    for (let i = 0; i < 200; i++) {
      const object = new THREE.Mesh(
        this.geometry,
        new THREE.MeshLambertMaterial({
          color: Math.random() * 0xffffff,
        }),
      );

      object.position.x = Math.random() * 4 - 2;
      object.position.y = Math.random() * 4;
      object.position.z = Math.random() * 4 - 2;

      object.userData.velocity = new THREE.Vector3();
      object.userData.velocity.x = Math.random() * 0.01 - 0.005;
      object.userData.velocity.y = Math.random() * 0.01 - 0.005;
      object.userData.velocity.z = Math.random() * 0.01 - 0.005;

      this.ballsGroup.add(object);
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

    // Adds some control so you can move through the scene using the mouse or keyboard.
    this.movementControl = new FirstPersonControls(this.camera, this.renderer.domElement);
    this.movementControl.movementSpeed = 20;
    this.movementControl.lookSpeed = 0.05;
    this.movementControl.lookVertical = true;

    // Adds different controls if seen on mobile.
    function setOrientationControls(e) {
      // If device orientation is not available, return.
      if (!e.alpha) {
        return;
      }

      // Create controls for mobile.
      this.movementControl = new THREE.DeviceOrientationControls(this.camera, true);
      this.movementControl.connect();
      this.movementControl.update();

      // this.renderer.domElement.addEventListener("click", fullscreen, false);

      window.removeEventListener("deviceorientation", setOrientationControls, true);
    }
    window.addEventListener("deviceorientation", setOrientationControls, true);

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

    this.movementControl.handleResize();
  };

  handleController = controller => {
    if (controller.userData.isSelecting) {
      const object = this.ballsGroup.children[this.count++];

      object.position.copy(controller.position);
      object.userData.velocity.x = (Math.random() - 0.5) * 3;
      object.userData.velocity.y = (Math.random() - 0.5) * 3;
      object.userData.velocity.z = Math.random() - 9;
      object.userData.velocity.applyQuaternion(controller.quaternion);

      if (this.count === this.ballsGroup.children.length) this.count = 0;
    }
  };

  render = () => {
    this.handleController(this.controller1);
    this.handleController(this.controller2);

    //

    const delta = this.clock.getDelta() * 0.8; // slow down simulation

    const range = 3 - this.radius;

    for (let i = 0; i < this.ballsGroup.children.length; i++) {
      const object = this.ballsGroup.children[i];

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

      for (let j = i + 1; j < this.ballsGroup.children.length; j++) {
        const object2 = this.ballsGroup.children[j];

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
    this.movementControl.update(this.clock.getDelta());
    this.renderer.render(this.scene, this.camera);
  };

  onSelectStart = () => {
    this.userData.isSelecting = true;
  };

  onSelectEnd = () => {
    this.userData.isSelecting = false;
  };
}
