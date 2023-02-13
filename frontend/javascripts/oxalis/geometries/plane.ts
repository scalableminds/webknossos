import * as THREE from "three";
import _ from "lodash";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";
import PlaneMaterialFactory from "oxalis/geometries/materials/plane_material_factory";
import Store from "oxalis/store";
import type { OrthoView, Vector2, Vector3, Vector4 } from "oxalis/constants";
import constants, {
  OrthoViewColors,
  OrthoViewCrosshairColors,
  OrthoViewGrayCrosshairColor,
  OrthoViewValues,
} from "oxalis/constants";

class Plane {
  // This class is supposed to collect all the Geometries that belong to one single plane such as
  // the plane itself, its texture, borders and crosshairs.
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'plane' has no initializer and is not def... Remove this comment to see the full error message
  plane: THREE.Mesh;
  planeID: OrthoView;
  materialFactory!: PlaneMaterialFactory;
  displayCrosshair: boolean;
  lastPositionUV: Vector2;
  baseScaleVector: THREE.Vector3;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'crosshair' has no initializer and is not... Remove this comment to see the full error message
  crosshair: Array<THREE.LineSegments>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'TDViewBorders' has no initializer and is... Remove this comment to see the full error message
  TDViewBorders: THREE.Line;
  lastScaleFactors: [number, number];

  constructor(planeID: OrthoView) {
    this.planeID = planeID;
    this.displayCrosshair = true;
    this.lastScaleFactors = [-1, -1];
    // VIEWPORT_WIDTH means that the plane should be that many voxels wide in the
    // dimension with the highest resolution. In all other dimensions, the plane
    // is smaller in voxels, so that it is squared in nm.
    // --> scaleInfo.baseVoxel
    const baseVoxelFactors = getBaseVoxelFactors(Store.getState().dataset.dataSource.scale);
    const scaleArray = Dimensions.transDim(baseVoxelFactors, this.planeID);
    this.baseScaleVector = new THREE.Vector3(...scaleArray);
    this.lastPositionUV = [0, 0];
    this.createMeshes();
  }

  createMeshes(): void {
    const pWidth = constants.VIEWPORT_WIDTH;
    // create plane
    const planeGeo = new THREE.PlaneGeometry(pWidth, pWidth, 100, 100);
    this.materialFactory = new PlaneMaterialFactory(
      this.planeID,
      true,
      OrthoViewValues.indexOf(this.planeID),
    );
    const textureMaterial = this.materialFactory.setup().getMaterial();
    this.plane = new THREE.Mesh(planeGeo, textureMaterial);
    // create crosshair
    const crosshairGeometries = [];
    this.crosshair = new Array(2);

    for (let i = 0; i <= 1; i++) {
      crosshairGeometries.push(new THREE.BufferGeometry());

      // prettier-ignore
      const crosshairVertices = new Float32Array([
        (-pWidth / 2) * i, (-pWidth / 2) * (1 - i), 0,
        -25 * i, -25 * (1 - i), 0,
        25 * i, 25 * (1 - i), 0,
        (pWidth / 2) * i, (pWidth / 2) * (1 - i), 0,
      ]);

      crosshairGeometries[i].setAttribute(
        "position",
        new THREE.BufferAttribute(crosshairVertices, 3),
      );
      this.crosshair[i] = new THREE.LineSegments(
        crosshairGeometries[i],
        this.getLineBasicMaterial(OrthoViewCrosshairColors[this.planeID][i], 1),
      );
      // Objects are rendered according to their renderOrder (lowest to highest).
      // The default renderOrder is 0. In order for the crosshairs to be shown
      // render them AFTER the plane has been rendered.
      this.crosshair[i].renderOrder = 1;
    }

    // create borders
    const vertices = [];
    vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    vertices.push(new THREE.Vector3(-pWidth / 2, pWidth / 2, 0));
    vertices.push(new THREE.Vector3(pWidth / 2, pWidth / 2, 0));
    vertices.push(new THREE.Vector3(pWidth / 2, -pWidth / 2, 0));
    vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    const tdViewBordersGeo = new THREE.BufferGeometry().setFromPoints(vertices);

    this.TDViewBorders = new THREE.Line(
      tdViewBordersGeo,
      this.getLineBasicMaterial(OrthoViewColors[this.planeID], 1),
    );
  }

  setDisplayCrosshair = (value: boolean): void => {
    this.displayCrosshair = value;
  };

  getLineBasicMaterial = _.memoize(
    (color: number, linewidth: number) =>
      new THREE.LineBasicMaterial({
        color,
        linewidth,
      }),
    (color: number, linewidth: number) => `${color}_${linewidth}`,
  );

  setOriginalCrosshairColor = (): void => {
    [0, 1].forEach((i) => {
      this.crosshair[i].material = this.getLineBasicMaterial(
        OrthoViewCrosshairColors[this.planeID][i],
        1,
      );
    });
  };

  setGrayCrosshairColor = (): void => {
    [0, 1].forEach((i) => {
      this.crosshair[i].material = this.getLineBasicMaterial(OrthoViewGrayCrosshairColor, 1);
    });
  };

  setScale(xFactor: number, yFactor: number): void {
    if (this.lastScaleFactors[0] !== xFactor || this.lastScaleFactors[1] !== yFactor) {
      this.lastScaleFactors[0] = xFactor;
      this.lastScaleFactors[1] = yFactor;
    } else {
      return;
    }

    const scaleVec = new THREE.Vector3().multiplyVectors(
      new THREE.Vector3(xFactor, yFactor, 1),
      this.baseScaleVector,
    );
    this.plane.scale.copy(scaleVec);
    this.TDViewBorders.scale.copy(scaleVec);
    this.crosshair[0].scale.copy(scaleVec);
    this.crosshair[1].scale.copy(scaleVec);
    this.updateTesselation();
  }

  setRotation = (rotVec: THREE.Euler): void => {
    [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]].map((mesh) =>
      mesh.setRotationFromEuler(rotVec),
    );
  };

  // In case the plane's position was offset to make geometries
  // on the plane visible (by moving the plane to the back), one can
  // additionally pass the originalPosition (which is necessary for the
  // shader)
  setPosition = (pos: Vector3, originalPosition?: Vector3): void => {
    const [x, y, z] = pos;
    this.TDViewBorders.position.set(x, y, z);
    this.crosshair[0].position.set(x, y, z);
    this.crosshair[1].position.set(x, y, z);
    this.plane.position.set(x, y, z);

    if (originalPosition == null) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'setGlobalPosition' does not exist on typ... Remove this comment to see the full error message
      this.plane.material.setGlobalPosition(x, y, z);
    } else {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'setGlobalPosition' does not exist on typ... Remove this comment to see the full error message
      this.plane.material.setGlobalPosition(
        originalPosition[0],
        originalPosition[1],
        originalPosition[2],
      );
    }
    this.updateTesselation();
  };

  updateTesselation() {
    return;
    const newestPosUV = Dimensions.transDim(this.plane.position.toArray(), this.planeID).slice(
      0,
      2,
    ) as Vector2;
    if (_.isEqual(this.lastPositionUV, newestPosUV)) {
      // todo: also check whether scale changed
      return;
    }
    this.lastPositionUV = newestPosUV;
    const positions = this.plane.geometry.attributes.position.array;

    let x, y, z, index;
    x = y = z = index = 0;

    const width = constants.VIEWPORT_WIDTH,
      height = constants.VIEWPORT_WIDTH;
    const widthSegments = 100;
    const heightSegments = 100;
    const width_half = width / 2;
    const height_half = height / 2;
    const gridX = Math.floor(widthSegments);
    const gridY = Math.floor(heightSegments);
    const gridX1 = gridX + 1;
    const gridY1 = gridY + 1;
    const segment_width = width / gridX;
    const segment_height = height / gridY;

    for (let iy = 0; iy < gridY1; iy++) {
      const y = iy * segment_height - height_half;

      for (let ix = 0; ix < gridX1; ix++) {
        const x = ix * segment_width - width_half;

        // @ts-ignore
        positions[index++] = x;
        // @ts-ignore
        positions[index++] = -y;
        // @ts-ignore
        positions[index++] = 0;
      }
    }
  }

  // updateTesselation() {
  //   const newestPosUV = Dimensions.transDim(this.plane.position.toArray(), this.planeID).slice(
  //     0,
  //     2,
  //   ) as Vector2;
  //   if (_.isEqual(this.lastPositionUV, newestPosUV)) {
  //     // todo: also check whether scale changed
  //     return;
  //   }
  //   this.lastPositionUV = newestPosUV;
  //   const positions = this.plane.geometry.attributes.position.array;

  //   let index = 0;

  //   // x and y will range from -188 to +188 (== 376/2)
  //   const width = constants.VIEWPORT_WIDTH; // 376
  //   const height = constants.VIEWPORT_WIDTH;
  //   const widthSegments = 100;
  //   const heightSegments = 100;
  //   const width_half = width / 2;
  //   const height_half = height / 2;
  //   const gridX = Math.floor(widthSegments); // 50
  //   const gridY = Math.floor(heightSegments);
  //   const gridX1 = gridX + 1; // 51
  //   const gridY1 = gridY + 1;
  //   const segment_width = width / gridX; // 7.52
  //   const segment_height = height / gridY;

  //   const logs = [];
  //   // todo!
  //   const downToNearestMultiple = (x: number, m: number) => Math.floor(x / m) * m;
  //   const scale = 1;
  //   let vertexCount = 0;
  //   for (let iy = 0; iy < gridY1; iy++) {
  //     const y = iy * segment_height - height_half;

  //     for (let ix = 0; ix < gridX1; ix++) {
  //       let x = ix * segment_width - width_half;

  //       if (ix === 0) {
  //         x = -width_half;
  //       } else {
  //         x = Math.min(
  //           downToNearestMultiple(newestPosUV[0] - width_half / scale, 32) +
  //             32 * ix -
  //             newestPosUV[0],
  //           width_half,
  //         );
  //       }
  //       if (iy === 0) {
  //         logs.push(x);
  //       }
  //       if (x >= width_half) {
  //         break;
  //       }

  //       // @ts-ignore
  //       positions[index++] = x;
  //       // @ts-ignore
  //       positions[index++] = -y;
  //       // @ts-ignore
  //       positions[index++] = 0;
  //       vertexCount += 3;
  //     }
  //   }
  //   this.plane.geometry.attributes.position.needsUpdate = true;
  //   this.plane.geometry.setDrawRange(0, vertexCount);
  //   // this.plane.geometry.setIndex(null);
  //   console.log("logs", logs);
  // }

  setVisible = (isVisible: boolean, isDataVisible?: boolean): void => {
    this.plane.visible = isDataVisible != null ? isDataVisible : isVisible;
    this.TDViewBorders.visible = isVisible;
    this.crosshair[0].visible = isVisible && this.displayCrosshair;
    this.crosshair[1].visible = isVisible && this.displayCrosshair;
  };

  getMeshes = () => [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]];
  setLinearInterpolationEnabled = (enabled: boolean) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setUseBilinearFiltering' does not exist ... Remove this comment to see the full error message
    this.plane.material.setUseBilinearFiltering(enabled);
  };
}

export default Plane;
