import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import THREE from "three";
import Plane from "../geometries/plane";
import Skeleton from "../geometries/skeleton";
import Cube from "../geometries/cube";
import ContourGeometry from "../geometries/contourgeometry";
import VolumeGeometry from "../geometries/volumegeometry";
import Dimensions from "../model/dimensions";
import constants from "../constants";
import PolygonFactory from "../view/polygons/polygon_factory";

class SceneController {
  static initClass() {
    // This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
    // element depending on the provided flycam.

    this.prototype.CUBE_COLOR = 0x999999;
  }

  constructor(upperBoundary, flycam, model) {
    this.updateSceneForCam = this.updateSceneForCam.bind(this);
    this.update = this.update.bind(this);
    this.setDisplayPlanes = this.setDisplayPlanes.bind(this);
    this.getMeshes = this.getMeshes.bind(this);
    this.upperBoundary = upperBoundary;
    this.flycam = flycam;
    this.model = model;
    _.extend(this, Backbone.Events);

    this.current = 0;
    this.displayPlane = [true, true, true];
    this.planeShift = [0, 0, 0];
    this.pingBinary = true;
    this.pingBinarySeg = true;

    this.volumeMeshes = [];

    this.createMeshes();
    this.bindToEvents();
  }


  createMeshes() {
    // Cubes
    this.cube = new Cube(this.model, {
      max: this.upperBoundary,
      color: this.CUBE_COLOR,
      showCrossSections: true });
    this.userBoundingBox = new Cube(this.model, {
      max: [0, 0, 0],
      color: 0xffaa00,
      showCrossSections: true });

    if (this.model.taskBoundingBox != null) {
      this.taskBoundingBox = new Cube(this.model, {
        min: this.model.taskBoundingBox.min,
        max: this.model.taskBoundingBox.max,
        color: 0x00ff00,
        showCrossSections: true });
    }

    // TODO: Implement text

    if (this.model.volumeTracing != null) {
      this.contour = new ContourGeometry(this.model.volumeTracing, this.model.flycam);
    }

    if (this.model.skeletonTracing != null) {
      this.skeleton = new Skeleton(this.model);
    }

    // create Meshes
    this.planes = new Array(3);
    for (const i of [constants.PLANE_XY, constants.PLANE_YZ, constants.PLANE_XZ]) {
      this.planes[i] = new Plane(constants.PLANE_WIDTH, constants.TEXTURE_WIDTH, this.flycam, i, this.model);
    }

    this.planes[constants.PLANE_XY].setRotation(new THREE.Euler(Math.PI, 0, 0));
    this.planes[constants.PLANE_YZ].setRotation(new THREE.Euler(Math.PI, (1 / 2) * Math.PI, 0));
    return this.planes[constants.PLANE_XZ].setRotation(new THREE.Euler((-1 / 2) * Math.PI, 0, 0));
  }


  removeShapes() {
    return this.trigger("removeGeometries", this.volumeMeshes);
  }


  showShapes(bb, resolution, id) {
    if (this.model.getSegmentationBinary() == null) { return; }

    if (this.polygonFactory != null) {
      this.polygonFactory.cancel();
    }

    this.polygonFactory = new PolygonFactory(
      this.model.getSegmentationBinary().cube,
      resolution,
      bb.min, bb.max, id,
    );

    return this.polygonFactory.getTriangles().then((triangles) => {
      this.removeShapes();
      this.volumeMeshes = [];

      for (id in triangles) {
        const mappedId = this.model.getSegmentationBinary().cube.mapId(parseInt(id));
        const volume = new VolumeGeometry(triangles[id], mappedId);
        this.volumeMeshes = this.volumeMeshes.concat(volume.getMeshes());
      }

      this.trigger("newGeometries", this.volumeMeshes);
      app.vent.trigger("rerender");
      return this.polygonFactory = null;
    },
    );
  }


  updateSceneForCam(id) {
    // This method is called for each of the four cams. Even
    // though they are all looking at the same scene, some
    // things have to be changed for each cam.

    let mesh,
      pos;
    this.cube.updateForCam(id);
    this.userBoundingBox.updateForCam(id);
    __guard__(this.taskBoundingBox, x => x.updateForCam(id));
    __guard__(this.skeleton, x1 => x1.updateForCam(id));

    if (constants.ALL_PLANES.includes(id)) {
      let ind;
      for (mesh of this.volumeMeshes) {
        mesh.visible = false;
      }
      for (const i of constants.ALL_PLANES) {
        if (i === id) {
          this.planes[i].setOriginalCrosshairColor();
          this.planes[i].setVisible(true);
          pos = this.flycam.getPosition().slice();
          ind = Dimensions.getIndices(i);
          // Offset the plane so the user can see the skeletonTracing behind the plane
          pos[ind[2]] += i === constants.PLANE_XY ? this.planeShift[ind[2]] : -this.planeShift[ind[2]];
          this.planes[i].setPosition(new THREE.Vector3(...pos));
        } else {
          this.planes[i].setVisible(false);
        }
      }
    } else {
      for (mesh of this.volumeMeshes) {
        mesh.visible = true;
      }
      for (const i of constants.ALL_PLANES) {
        pos = this.flycam.getPosition();
        this.planes[i].setPosition(new THREE.Vector3(pos[0], pos[1], pos[2]));
        this.planes[i].setGrayCrosshairColor();
        this.planes[i].setVisible(true);
        this.planes[i].plane.visible = this.displayPlane[i];
      }
    }
  }


  update() {
    const gPos = this.flycam.getPosition();
    const globalPosVec = new THREE.Vector3(...gPos);
    const planeScale = this.flycam.getPlaneScalingFactor();
    for (const i of constants.ALL_PLANES) {
      this.planes[i].updateTexture();

      // Update plane position
      this.planes[i].setPosition(globalPosVec);

      // Update plane scale
      this.planes[i].setScale(planeScale);
    }
  }


  setTextRotation() {}

    // TODO: Implement


  setDisplayCrosshair(value) {
    for (const plane of this.planes) {
      plane.setDisplayCrosshair(value);
    }
    return app.vent.trigger("rerender");
  }


  setClippingDistance(value) {
    // convert nm to voxel
    for (const i of constants.ALL_PLANES) {
      this.planeShift[i] = value * app.scaleInfo.voxelPerNM[i];
    }
    return app.vent.trigger("rerender");
  }


  setInterpolation(value) {
    for (const plane of this.planes) {
      plane.setLinearInterpolationEnabled(value);
    }
    return app.vent.trigger("rerender");
  }


  setDisplayPlanes(value) {
    for (let i = 0; i <= 2; i++) {
      this.displayPlane[i] = value;
    }
    return app.vent.trigger("rerender");
  }


  getMeshes() {
    let result = [];
    for (const plane of this.planes) {
      result = result.concat(plane.getMeshes());
    }

    for (const geometry of [this.skeleton, this.contour, this.cube, this.userBoundingBox, this.taskBoundingBox]) {
      if (geometry != null) {
        result = result.concat(geometry.getMeshes());
      }
    }

    return result;
  }


  setUserBoundingBox(bb) {
    return this.userBoundingBox.setCorners(bb.min, bb.max);
  }


  setSegmentationAlpha(alpha) {
    for (const plane of this.planes) {
      plane.setSegmentationAlpha(alpha);
    }
    return this.pingBinarySeg = alpha !== 0;
  }

  pingDataLayer(dataLayerName) {
    if (this.model.binary[dataLayerName].category === "color") {
      return this.pingBinary;
    }
    if (this.model.binary[dataLayerName].category === "segmentation") {
      return this.pingBinarySeg;
    }
    return false;
  }


  stop() {
    for (const plane of this.planes) {
      plane.setVisible(false);
    }
    this.cube.setVisibility(false);
    this.userBoundingBox.setVisibility(false);
    __guard__(this.taskBoundingBox, x => x.setVisibility(false));

    __guard__(this.skeleton, x1 => x1.restoreVisibility());
    return __guard__(this.skeleton, x2 => x2.setSizeAttenuation(true));
  }


  start() {
    for (const plane of this.planes) {
      plane.setVisible(true);
    }
    this.cube.setVisibility(true);
    this.userBoundingBox.setVisibility(true);
    __guard__(this.taskBoundingBox, x => x.setVisibility(true));

    return __guard__(this.skeleton, x1 => x1.setSizeAttenuation(false));
  }


  bindToEvents() {
    const { user } = this.model;
    this.listenTo(this.model, "change:userBoundingBox", function (bb) { return this.setUserBoundingBox(bb); });
    this.listenTo(user, "change:segmentationOpacity", function (model, opacity) {
      return this.setSegmentationAlpha(opacity);
    });
    this.listenTo(user, "change:clippingDistance", function (model, value) { return this.setClippingDistance(value); });
    this.listenTo(user, "change:displayCrosshair", function (model, value) { return this.setDisplayCrosshair(value); });
    this.listenTo(this.model.datasetConfiguration, "change:interpolation", function (model, value) {
      return this.setInterpolation(value);
    });
    return this.listenTo(user, "change:tdViewDisplayPlanes", function (model, value) { return this.setDisplayPlanes(value); });
  }
}
SceneController.initClass();

export default SceneController;

function __guard__(value, transform) {
  return (typeof value !== "undefined" && value !== null) ? transform(value) : undefined;
}
