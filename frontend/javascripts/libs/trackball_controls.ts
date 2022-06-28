import * as THREE from "three";
import window, { document } from "libs/window";
import { AnyCamera, Rect } from "oxalis/constants";

/**
 * The MIT License
 *
 * Copyright © 2010-2017 three.js authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * @author Eberhard Graether / http://egraether.com/
 * @author Mark Lundin / http://mark-lundin.com
 */

interface ITrackballControls {
  forBothCameras: (func: (cam: AnyCamera) => void) => void;
  new (
    orthoCamera: THREE.OrthographicCamera,
    perspectiveCamera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    target: THREE.Vector3,
    updateCallback: (args: any) => void,
  ): ITrackballControls;

  orthoCamera: THREE.OrthographicCamera;
  perspectiveCamera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  enabled: boolean;
  updateCallback: (args: any) => void;
  keyboardEnabled: boolean;
  rotateSpeed: number;
  zoomSpeed: number;
  panSpeed: number;
  noRotate: boolean;
  noZoom: boolean;
  noPan: boolean;
  noRoll: boolean;
  staticMoving: boolean;
  dynamicDampingFactor: number;
  minDistance: number;
  maxDistance: number;
  keys: number[];
  target: THREE.Vector3;
  up: THREE.Vector3;
  position: THREE.Vector3;
  lastTarget: THREE.Vector3;
  target0: THREE.Vector3;
  position0: THREE.Vector3;
  up0: THREE.Vector3;
  getScreenBounds: () => Rect;
  handleEvent: (arg0: Event) => void;
  rotateCamera: () => void;
  destroy: () => void;
  update: (externalUpdate?: boolean, userTriggered?: boolean) => void;
  getMouseOnScreen: (pageX: number, pageY: number, vector: THREE.Vector2) => THREE.Vector2;
  getMouseProjectionOnBall: (
    pageX: number,
    pageY: number,
    projection: THREE.Vector3,
  ) => THREE.Vector3;
  zoomCamera: () => void;
  panCamera: () => void;
  checkDistances: () => void;
  dispatchEvent(changeEvent: { type: string }): unknown;
  reset: () => void;
}

const TrackballControls = function (
  this: ITrackballControls,
  orthoCamera: THREE.OrthographicCamera,
  perspectiveCamera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  target: THREE.Vector3,
  updateCallback: (args: any) => void,
) {
  const _this = this;

  const STATE = {
    NONE: -1,
    PAN: 0,
    ZOOM: 1,
    ROTATE: 2,
    TOUCH_ROTATE: 3,
    TOUCH_ZOOM: 4,
    TOUCH_PAN: 5,
  };
  this.orthoCamera = orthoCamera;
  this.perspectiveCamera = perspectiveCamera;
  this.domElement = domElement;
  this.updateCallback = updateCallback;
  // API
  this.enabled = true;
  this.keyboardEnabled = false;
  this.rotateSpeed = 1.0;
  this.zoomSpeed = 1.2;
  this.panSpeed = 0.3;
  this.noRotate = false;
  this.noZoom = false;
  this.noPan = false;
  this.noRoll = false;
  this.staticMoving = false;
  this.dynamicDampingFactor = 0.2;
  this.minDistance = 0;
  this.maxDistance = Infinity;
  // [A, S, D]
  this.keys = [65, 83, 68];
  // internals
  this.target = target || new THREE.Vector3();
  this.lastTarget = this.target.clone();
  const lastPosition = new THREE.Vector3();
  let _state = STATE.NONE;
  let _prevState = STATE.NONE;

  const _eye = new THREE.Vector3();

  const _rotateStart = new THREE.Vector3();

  const _rotateEnd = new THREE.Vector3();

  const _zoomStart = new THREE.Vector2();

  const _zoomEnd = new THREE.Vector2();

  let _touchZoomDistanceStart = 0;
  let _touchZoomDistanceEnd = 0;

  const _panStart = new THREE.Vector2();

  const _panEnd = new THREE.Vector2();

  // for reset
  this.target0 = this.target.clone();
  this.position0 = this.orthoCamera.position.clone();
  this.up0 = this.orthoCamera.up.clone();
  // events
  const changeEvent = {
    type: "change",
  };
  const startEvent = {
    type: "start",
  };
  const endEvent = {
    type: "end",
  };

  // methods
  this.forBothCameras = function forBothCameras(func: (cam: AnyCamera) => void) {
    func(this.orthoCamera);
    func(this.perspectiveCamera);
  };
  this.getScreenBounds = function getScreenBounds() {
    const clientRect = this.domElement.getBoundingClientRect();
    const d = this.domElement.ownerDocument.documentElement;
    return {
      top: clientRect.top + window.pageYOffset - d.clientTop,
      left: clientRect.left + window.pageXOffset - d.clientLeft,
      width: clientRect.width,
      height: clientRect.height,
    };
  };

  this.handleEvent = function handleEvent(event: Event) {
    // @ts-ignore
    if (typeof this[event.type] === "function") {
      // @ts-ignore
      this[event.type](event);
    }
  };

  this.getMouseOnScreen = function getMouseOnScreen(
    pageX: number,
    pageY: number,
    vector: THREE.Vector2,
  ) {
    const screenBounds = _this.getScreenBounds();

    return vector.set(
      (pageX - screenBounds.left) / screenBounds.width,
      (pageY - screenBounds.top) / screenBounds.height,
    );
  };

  this.getMouseProjectionOnBall = (() => {
    const objectUp = new THREE.Vector3();
    const mouseOnBall = new THREE.Vector3();
    return (pageX: number, pageY: number, projection: THREE.Vector3) => {
      const screenBounds = _this.getScreenBounds();

      mouseOnBall.set(
        (pageX - screenBounds.width * 0.5 - screenBounds.left) / (screenBounds.width * 0.5),
        (screenBounds.height * 0.5 + screenBounds.top - pageY) / (screenBounds.height * 0.5),
        0.0,
      );
      const length = mouseOnBall.length();

      if (_this.noRoll) {
        if (length < Math.SQRT1_2) {
          mouseOnBall.z = Math.sqrt(1.0 - length * length);
        } else {
          mouseOnBall.z = 0.5 / length;
        }
      } else if (length > 1.0) {
        mouseOnBall.normalize();
      } else {
        mouseOnBall.z = Math.sqrt(1.0 - length * length);
      }

      _eye.copy(_this.orthoCamera.position).sub(_this.target);

      projection.copy(_this.orthoCamera.up).setLength(mouseOnBall.y);
      projection.add(objectUp.copy(_this.orthoCamera.up).cross(_eye).setLength(mouseOnBall.x));
      projection.add(_eye.setLength(mouseOnBall.z));
      return projection;
    };
  })();

  this.rotateCamera = (() => {
    const axis = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    return () => {
      let angle = Math.acos(
        _rotateStart.dot(_rotateEnd) / _rotateStart.length() / _rotateEnd.length(),
      );

      if (angle) {
        axis.crossVectors(_rotateStart, _rotateEnd).normalize();
        angle *= _this.rotateSpeed;
        quaternion.setFromAxisAngle(axis, -angle);

        _eye.applyQuaternion(quaternion);
        this.forBothCameras((camera) => camera.up.applyQuaternion(quaternion));

        _rotateEnd.applyQuaternion(quaternion);

        if (_this.staticMoving) {
          _rotateStart.copy(_rotateEnd);
        } else {
          quaternion.setFromAxisAngle(axis, angle * (_this.dynamicDampingFactor - 1.0));

          _rotateStart.applyQuaternion(quaternion);
        }
      }
    };
  })();

  this.zoomCamera = () => {
    if (_state === STATE.TOUCH_ZOOM) {
      const factor = _touchZoomDistanceStart / _touchZoomDistanceEnd;
      _touchZoomDistanceStart = _touchZoomDistanceEnd;

      _eye.multiplyScalar(factor);
    } else {
      const factor = 1.0 + (_zoomEnd.y - _zoomStart.y) * _this.zoomSpeed;

      if (factor !== 1.0 && factor > 0.0) {
        _eye.multiplyScalar(factor);

        if (_this.staticMoving) {
          _zoomStart.copy(_zoomEnd);
        } else {
          _zoomStart.y += (_zoomEnd.y - _zoomStart.y) * this.dynamicDampingFactor;
        }
      }
    }
  };

  this.panCamera = (() => {
    const mouseChange = new THREE.Vector2();
    const objectUp = new THREE.Vector3();
    const pan = new THREE.Vector3();
    return () => {
      mouseChange.copy(_panEnd).sub(_panStart);

      if (mouseChange.lengthSq()) {
        mouseChange.multiplyScalar(_eye.length() * _this.panSpeed);
        this.forBothCameras((camera) => {
          pan.copy(_eye).cross(camera.up).setLength(mouseChange.x);
          pan.add(objectUp.copy(camera.up).setLength(mouseChange.y));
          camera.position.add(pan);
        });

        _this.target.add(pan);

        if (_this.staticMoving) {
          _panStart.copy(_panEnd);
        } else {
          _panStart.add(
            mouseChange.subVectors(_panEnd, _panStart).multiplyScalar(_this.dynamicDampingFactor),
          );
        }
      }
    };
  })();

  this.checkDistances = () => {
    if (!_this.noZoom || !_this.noPan) {
      if (_eye.lengthSq() > _this.maxDistance * _this.maxDistance) {
        this.forBothCameras((camera) => {
          camera.position.addVectors(_this.target, _eye.setLength(_this.maxDistance));
        });
      }

      if (_eye.lengthSq() < _this.minDistance * _this.minDistance) {
        this.forBothCameras((camera) => {
          camera.position.addVectors(_this.target, _eye.setLength(_this.minDistance));
        });
      }
    }
  };

  this.update = (externalUpdate = false, userTriggered = false) => {
    _eye.subVectors(_this.orthoCamera.position, _this.lastTarget);

    if (!_this.noRotate) {
      _this.rotateCamera();
    }

    if (!_this.noZoom) {
      _this.zoomCamera();
    }

    if (!_this.noPan) {
      _this.panCamera();
    }
    this.forBothCameras((camera) => {
      camera.position.addVectors(_this.target, _eye);
    });

    _this.checkDistances();

    this.forBothCameras((camera) => {
      camera.position.addVectors(_this.target, _eye);
    });

    if (lastPosition.distanceToSquared(_this.orthoCamera.position) > 0) {
      _this.dispatchEvent(changeEvent);

      lastPosition.copy(_this.orthoCamera.position);
    }

    _this.lastTarget = _this.target.clone();

    if (!externalUpdate) {
      _this.updateCallback(userTriggered);
    }
  };

  this.reset = () => {
    _state = STATE.NONE;
    _prevState = STATE.NONE;

    _this.target.copy(_this.target0);

    this.forBothCameras((camera) => {
      camera.position.copy(_this.position0);

      camera.up.copy(_this.up0);

      camera.lookAt(_this.target);
    });
    _eye.subVectors(_this.orthoCamera.position, _this.target);

    _this.dispatchEvent(changeEvent);

    lastPosition.copy(_this.orthoCamera.position);
  };

  // listeners
  function keydown(event: KeyboardEvent) {
    if (_this.enabled === false || _this.keyboardEnabled === false) return;
    window.removeEventListener("keydown", keydown);
    _prevState = _state;

    if (_state !== STATE.NONE) {
      // Do nothing
    } else if (event.keyCode === _this.keys[STATE.ROTATE] && !_this.noRotate) {
      _state = STATE.ROTATE;
    } else if (event.keyCode === _this.keys[STATE.ZOOM] && !_this.noZoom) {
      _state = STATE.ZOOM;
    } else if (event.keyCode === _this.keys[STATE.PAN] && !_this.noPan) {
      _state = STATE.PAN;
    }
  }

  function keyup() {
    if (_this.enabled === false || _this.keyboardEnabled === false) return;
    _state = _prevState;
    window.addEventListener("keydown", keydown, false);
  }

  function mousedown(event: MouseEvent) {
    if (_this.enabled === false) return;
    event.preventDefault();

    if (_state === STATE.NONE) {
      _state = event.button;
    }

    if (_state === STATE.ROTATE && !_this.noRotate) {
      _this.getMouseProjectionOnBall(event.pageX, event.pageY, _rotateStart);

      _rotateEnd.copy(_rotateStart);
    } else if (_state === STATE.ZOOM && !_this.noZoom) {
      _this.getMouseOnScreen(event.pageX, event.pageY, _zoomStart);

      _zoomEnd.copy(_zoomStart);
    } else if (_state === STATE.PAN && !_this.noPan) {
      _this.getMouseOnScreen(event.pageX, event.pageY, _panStart);

      _panEnd.copy(_panStart);
    }

    document.addEventListener("mousemove", mousemove, false);
    document.addEventListener("mouseup", mouseup, false);

    _this.dispatchEvent(startEvent);
  }

  function mousemove(event: MouseEvent) {
    if (_this.enabled === false) return;
    event.preventDefault();

    if (_state === STATE.ROTATE && !_this.noRotate) {
      _this.getMouseProjectionOnBall(event.pageX, event.pageY, _rotateEnd);
    } else if (_state === STATE.ZOOM && !_this.noZoom) {
      _this.getMouseOnScreen(event.pageX, event.pageY, _zoomEnd);
    } else if (_state === STATE.PAN && !_this.noPan) {
      _this.getMouseOnScreen(event.pageX, event.pageY, _panEnd);
    }

    _this.update(false, true);
  }

  function mouseup(event: MouseEvent) {
    if (_this.enabled === false) return;
    event.preventDefault();
    _state = STATE.NONE;
    document.removeEventListener("mousemove", mousemove);
    document.removeEventListener("mouseup", mouseup);

    _this.dispatchEvent(endEvent);
  }

  function mousewheel(event: WheelEvent): void {
    if (_this.enabled === false) return;
    event.preventDefault();
    let delta = 0;

    if (event.deltaY) {
      // WebKit / Opera / Explorer 9
      delta = -event.deltaY / 40;
    } else if (event.detail) {
      // Firefox
      delta = -event.detail / 3;
    }

    _zoomStart.y += delta * 0.01;

    _this.dispatchEvent(startEvent);

    _this.dispatchEvent(endEvent);
  }

  function touchstart(event: TouchEvent) {
    if (_this.enabled === false) return;

    switch (event.touches.length) {
      case 3:
        _state = STATE.TOUCH_ROTATE;

        _rotateEnd.copy(
          _this.getMouseProjectionOnBall(
            event.touches[0].pageX,
            event.touches[0].pageY,
            _rotateStart,
          ),
        );

        break;

      case 2: {
        _state = STATE.TOUCH_ZOOM;
        const dx = event.touches[0].pageX - event.touches[1].pageX;
        const dy = event.touches[0].pageY - event.touches[1].pageY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        _touchZoomDistanceEnd = distance;
        _touchZoomDistanceStart = distance;
        break;
      }

      case 1:
        _state = STATE.TOUCH_PAN;

        _panEnd.copy(
          _this.getMouseOnScreen(event.touches[0].pageX, event.touches[0].pageY, _panStart),
        );

        break;

      default:
        _state = STATE.NONE;
    }

    _this.dispatchEvent(startEvent);
  }

  function touchmove(event: TouchEvent) {
    if (_this.enabled === false) return;
    event.preventDefault();

    switch (event.touches.length) {
      case 3:
        if (_state === STATE.TOUCH_ROTATE && !_this.noRotate) {
          _this.getMouseProjectionOnBall(
            event.touches[0].pageX,
            event.touches[0].pageY,
            _rotateEnd,
          );
        }

        break;

      case 2: {
        if (_state === STATE.TOUCH_ZOOM && !_this.noZoom) {
          const dx = event.touches[0].pageX - event.touches[1].pageX;
          const dy = event.touches[0].pageY - event.touches[1].pageY;
          _touchZoomDistanceEnd = Math.sqrt(dx * dx + dy * dy);
        }

        break;
      }

      case 1:
        if (_state === STATE.TOUCH_PAN && !_this.noPan) {
          _this.getMouseOnScreen(event.touches[0].pageX, event.touches[0].pageY, _panEnd);
        }

        break;

      default:
        _state = STATE.NONE;
    }

    _this.update(false, true);
  }

  function touchend(event: TouchEvent) {
    if (_this.enabled === false) return;

    if (_state === STATE.TOUCH_ROTATE && !_this.noRotate) {
      _rotateStart.copy(
        _this.getMouseProjectionOnBall(event.touches[0].pageX, event.touches[0].pageY, _rotateEnd),
      );
    } else if (_state === STATE.TOUCH_ZOOM && !_this.noZoom) {
      _touchZoomDistanceStart = 0;
      _touchZoomDistanceEnd = 0;
    } else if (_state === STATE.TOUCH_PAN && !_this.noPan) {
      _panStart.copy(
        _this.getMouseOnScreen(event.touches[0].pageX, event.touches[0].pageY, _panEnd),
      );
    }

    _state = STATE.NONE;

    _this.dispatchEvent(endEvent);
  }

  this.destroy = () => {
    this.domElement.removeEventListener(
      "contextmenu",
      (event: Event) => {
        event.preventDefault();
      },
      false,
    );
    this.domElement.removeEventListener("mousedown", mousedown, false);
    this.domElement.removeEventListener("mousewheel", mousewheel as EventListener, false);
    this.domElement.removeEventListener("DOMMouseScroll", mousewheel as EventListener, false); // firefox

    this.domElement.removeEventListener("touchstart", touchstart, false);
    this.domElement.removeEventListener("touchend", touchend, false);
    this.domElement.removeEventListener("touchmove", touchmove, false);
    window.removeEventListener("keydown", keydown, false);
    window.removeEventListener("keyup", keyup, false);
  };

  this.domElement.addEventListener(
    "contextmenu",
    (event: Event) => {
      event.preventDefault();
    },
    false,
  );
  this.domElement.addEventListener("mousedown", mousedown, false);
  this.domElement.addEventListener("mousewheel", mousewheel as EventListener, false);
  this.domElement.addEventListener("DOMMouseScroll", mousewheel as EventListener, false); // firefox

  this.domElement.addEventListener("touchstart", touchstart, false);
  this.domElement.addEventListener("touchend", touchend, false);
  this.domElement.addEventListener("touchmove", touchmove, false);
  window.addEventListener("keydown", keydown, false);
  window.addEventListener("keyup", keyup, false);
  this.update();
} as any as ITrackballControls;

TrackballControls.prototype = Object.create(THREE.EventDispatcher.prototype);
export default TrackballControls;
