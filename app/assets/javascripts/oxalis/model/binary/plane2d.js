/**
 * plane2d.js
 * @flow
 */

import _ from "lodash";
import Backbone from "backbone";
import DataCube from "oxalis/model/binary/data_cube";
import Dimensions from "oxalis/model/dimensions";
import { BUCKET_SIZE_P } from "oxalis/model/binary/bucket";

import constants from "oxalis/constants";

import type { Vector2, Vector3, Vector4, OrthoViewType } from "oxalis/constants";

class DataTexture {
  buffer = new Uint8Array();
  layer: number = 0;
  tiles: Array<boolean> = [];
  ready: boolean = false;
  zoomStep: number = 0;
  topLeftBucket: Vector3 = [0, 0, 0];
  area: Vector2 = [0, 0, 0, 0];
  counter: number = 0;
}

type RenderBufferTarget = {
  buffer: Uint8Array;
  offset: number;
  widthP: number;
  rowDelta: number;
}

type RenderBufferSource = {
  buffer: Uint8Array;
  offset: number;
  rowDelta: number;
  pixelDelta: number;
  pixelRepeatP: number;
  rowRepeatP: number;
  mapping: ?Array<number>;
};

type BucketPlaceholder = {
  type: "RECURSION_PLACEHOLDER";
} | {
  type: "NOT_LOADED_BUCKET_PLACEHOLDER";
};

type RenderMapDescriptor = null | Vector4 | BucketPlaceholder;

const Plane2DConstants = {
  DELTA: [0, 5, 10],
  RECURSION_PLACEHOLDER: { type: "RECURSION_PLACEHOLDER" },
  NOT_LOADED_BUCKET_PLACEHOLDER: { type: "NOT_LOADED_BUCKET_PLACEHOLDER" },
};

// Helper functions
function tileIndexByTile(tile: Vector2): number {
  return (tile[0] * (1 << (constants.TEXTURE_SIZE_P - BUCKET_SIZE_P))) + tile[1];
}

function subTileMacro(tile: Vector2, index: number): Vector2 {
  return [(tile[0] << 1) + (index % 2), (tile[1] << 1) + (index >> 1)];
}

function bufferOffsetByTile(tile: Vector2, tileSize: number): number {
  return (tile[0] * (1 << tileSize)) + (tile[1] * (1 << tileSize) * (1 << constants.TEXTURE_SIZE_P));
}

class Plane2D {
  index: OrthoViewType;
  cube: DataCube;
  DATA_BIT_DEPTH: number;
  TEXTURE_BIT_DEPTH: number;
  MAPPED_DATA_BIT_DEPTH: number;
  BUCKETS_PER_ROW: number;
  TEXTURE_SIZE: number;
  NOT_LOADED_BUCKET_INTENSITY: number = 100;
  NOT_LOADED_BUCKET_DATA: Uint8Array;
  needsRedraw: boolean;
  MAP_SIZE: number = 0;
  U: number = 0;
  V: number = 0;
  W: number = 0;
  dataTexture = new DataTexture();

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(index: OrthoViewType, cube: DataCube, DATA_BIT_DEPTH: number,
    TEXTURE_BIT_DEPTH: number, MAPPED_DATA_BIT_DEPTH: number, isSegmentation: boolean) {
    _.extend(this, Backbone.Events);
    this.index = index;
    this.cube = cube;
    this.DATA_BIT_DEPTH = DATA_BIT_DEPTH;
    this.TEXTURE_BIT_DEPTH = TEXTURE_BIT_DEPTH;
    this.MAPPED_DATA_BIT_DEPTH = MAPPED_DATA_BIT_DEPTH;

    this.BUCKETS_PER_ROW = 1 << (constants.TEXTURE_SIZE_P - BUCKET_SIZE_P);
    this.TEXTURE_SIZE = (1 << (constants.TEXTURE_SIZE_P << 1)) * (this.TEXTURE_BIT_DEPTH >> 3);

    if (isSegmentation) {
      this.NOT_LOADED_BUCKET_INTENSITY = 0;
    }
    this.NOT_LOADED_BUCKET_DATA = new Uint8Array(this.cube.BUCKET_LENGTH);
    for (let i = 0; i < this.NOT_LOADED_BUCKET_DATA.length; i++) {
      this.NOT_LOADED_BUCKET_DATA[i] = this.NOT_LOADED_BUCKET_INTENSITY;
    }

    this.needsRedraw = false;

    for (let i = 0; i <= this.cube.LOOKUP_DEPTH_DOWN; i++) {
      this.MAP_SIZE += 1 << (i << 1);
    }

    const dimensions = Dimensions.getIndices(this.index);
    this.U = dimensions[0];
    this.V = dimensions[1];
    this.W = dimensions[2];

    this.listenTo(this.cube, "bucketLoaded", (bucket: Vector4): void => {
      const zoomStepDiff = this.dataTexture.zoomStep - bucket[3];
      if (zoomStepDiff > 0) {
        bucket = [
          bucket[0] >> zoomStepDiff,
          bucket[1] >> zoomStepDiff,
          bucket[2] >> zoomStepDiff,
          this.dataTexture.zoomStep,
        ];
      }

      // Checking, whether the new bucket intersects with the current layer
      if (this.dataTexture.layer >> (BUCKET_SIZE_P + bucket[3]) === bucket[this.W] &&
          (this.dataTexture.topLeftBucket != null)) {
        // Get the tile, the bucket would be drawn to
        const u = bucket[this.U] - this.dataTexture.topLeftBucket[this.U];
        const v = bucket[this.V] - this.dataTexture.topLeftBucket[this.V];

        // If the tile is part of the texture, mark it as changed
        if (u >= 0 && u < this.BUCKETS_PER_ROW && v >= 0 && v < this.BUCKETS_PER_ROW) {
          const tile = [u, v];
          this.dataTexture.tiles[tileIndexByTile(tile)] = false;

          if ((u >= this.dataTexture.area[0] || u <= this.dataTexture.area[2] ||
              v >= this.dataTexture.area[1] || v <= this.dataTexture.area[3])) {
            this.dataTexture.ready = false;
          }
        }
      }
    });

    this.cube.on("volumeLabeled", () => this.reset());
  }


  reset(): void {
    this.dataTexture.tiles = new Array(this.BUCKETS_PER_ROW * this.BUCKETS_PER_ROW);
    this.dataTexture.ready = false;
  }


  forceRedraw(): void {
    this.needsRedraw = true;
  }


  hasChanged(): boolean {
    return !this.dataTexture.ready;
  }


  get({ position, zoomStep, area }: { position: Vector3, zoomStep: number, area: Vector4 }): ?Uint8Array {
    return this.getTexture(this.dataTexture, position, zoomStep, area);
  }


  getTexture(texture: DataTexture, position: Vector3, zoomStep: number, area: Vector4): ?Uint8Array {
    if (texture.counter == null) {
      texture.counter = 0;
    }
    texture.counter++;

    // Saving the layer, we'll have to render
    const layer = position[this.W];

    // Making sure, position is top-left corner of some bucket
    position = [
      position[0] & ~0b11111,
      position[1] & ~0b11111,
      position[2] & ~0b11111,
    ];

    // Calculating the coordinates of the textures top-left corner
    const topLeftPosition = position.slice(0);
    topLeftPosition[this.U] -= 1 << ((constants.TEXTURE_SIZE_P - 1) + zoomStep);
    topLeftPosition[this.V] -= 1 << ((constants.TEXTURE_SIZE_P - 1) + zoomStep);

    const topLeftBucket = this.cube.positionToZoomedAddress(topLeftPosition, zoomStep);

    // Converting area from voxels to buckets
    area = [
      area[0] >> BUCKET_SIZE_P,
      area[1] >> BUCKET_SIZE_P,
      (area[2] - 1) >> BUCKET_SIZE_P,
      (area[3] - 1) >> BUCKET_SIZE_P,
    ];

    // If layer or zoomStep have changed, everything needs to be redrawn
    if (this.needsRedraw || !_.isEqual(texture.layer, layer) || !_.isEqual(texture.zoomStep, zoomStep)) {
      texture.layer = layer;
      texture.zoomStep = zoomStep;
      texture.topLeftBucket = topLeftBucket;
      texture.area = area;

      texture.tiles = new Array(this.BUCKETS_PER_ROW * this.BUCKETS_PER_ROW);
      texture.buffer = new Uint8Array(this.TEXTURE_SIZE);
      texture.ready = false;

      this.needsRedraw = false;
    }

    // If the top-left-bucket has changed, still visible tiles are copied to their new location
    if (!_.isEqual(texture.topLeftBucket, topLeftBucket)) {
      const oldTopLeftBucket = texture.topLeftBucket;
      texture.topLeftBucket = topLeftBucket;

      texture.tiles = new Array(this.BUCKETS_PER_ROW * this.BUCKETS_PER_ROW);
      texture.buffer = new Uint8Array(this.TEXTURE_SIZE);
      texture.ready = false;

      // Calculating boundaries for copying
      const width = (1 << (constants.TEXTURE_SIZE_P - BUCKET_SIZE_P)) - Math.abs(texture.topLeftBucket[this.U] - oldTopLeftBucket[this.U]);
      const height = (1 << (constants.TEXTURE_SIZE_P - BUCKET_SIZE_P)) - Math.abs(texture.topLeftBucket[this.V] - oldTopLeftBucket[this.V]);
      const oldOffset = [
        Math.max(texture.topLeftBucket[this.U] - oldTopLeftBucket[this.U], 0),
        Math.max(texture.topLeftBucket[this.V] - oldTopLeftBucket[this.V], 0),
      ];
      const newOffset = [
        Math.max(oldTopLeftBucket[this.U] - texture.topLeftBucket[this.U], 0),
        Math.max(oldTopLeftBucket[this.V] - texture.topLeftBucket[this.V], 0),
      ];

      // Copying tiles
      for (let du = 1; du < width; du++) {
        for (let dv = 1; dv < height; dv++) {
          const oldTile = [oldOffset[0] + du, oldOffset[1] + dv];
          const newTile = [newOffset[0] + du, newOffset[1] + dv];

          tileIndexByTile(oldTile);
          tileIndexByTile(newTile);
        }
      }
    }

    // If something has changed, only changed tiles are drawn
    if (!texture.ready || !_.isEqual(texture.area, area)) {
      texture.ready = true;
      texture.area = area;

      // Tiles are rendered from the bottom-right to the top-left corner
      // to make linear interpolation possible in the future
      for (let u = area[2]; u >= area[0]; u--) {
        for (let v = area[3]; v >= area[1]; v--) {
          const tile = [u, v];
          const tileIndex = tileIndexByTile(tile);

          // Render tile if necessary and mark it as rendered
          if (!texture.tiles[tileIndex]) {
            this.renderDataTile(tile);
            texture.tiles[tileIndex] = true;
          }
        }
      }

      return texture.buffer;
    } else {
      // If the texture didn't need to be changed...
      return null;
    }
  }


  copyTile(destTile: Vector2, sourceTile: Vector2, destBuffer: Uint8Array, sourceBuffer: Uint8Array): * {
    const destOffset = bufferOffsetByTile(destTile, BUCKET_SIZE_P);
    const sourceOffset = bufferOffsetByTile(sourceTile, BUCKET_SIZE_P);

    return this.renderToBuffer({
      buffer: destBuffer,
      offset: destOffset,
      widthP: BUCKET_SIZE_P,
      rowDelta: 1 << constants.TEXTURE_SIZE_P,
    }, {
      buffer: sourceBuffer,
      offset: sourceOffset,
      pixelDelta: 1,
      rowDelta: 1 << constants.TEXTURE_SIZE_P,
      pixelRepeatP: 0,
      rowRepeatP: 0,
      mapping: null,
    });
  }

  renderDataTile(tile: Vector2): void {
    const bucket = this.dataTexture.topLeftBucket.slice(0);
    bucket[this.U] += tile[0];
    bucket[this.V] += tile[1];
    const map = this.generateRenderMap(bucket);
    this.renderSubTile(map, 0, tile, this.dataTexture.zoomStep);
  }


  renderSubTile(map: Array<RenderMapDescriptor>, mapIndex: number, tile: Vector2, tileZoomStep: number): void {
    let tileSizeP;
    const mapEntry = map[mapIndex];
    if (mapEntry == null) {
      // pass
    } else if (mapEntry === Plane2DConstants.RECURSION_PLACEHOLDER) {
      for (let i = 0; i <= 3; i++) {
        const subTile = subTileMacro(tile, i);
        this.renderSubTile(map, (mapIndex << 2) + 1 + i, subTile, tileZoomStep - 1);
      }
    } else if (mapEntry === Plane2DConstants.NOT_LOADED_BUCKET_PLACEHOLDER) {
      tileSizeP = BUCKET_SIZE_P - (this.dataTexture.zoomStep - tileZoomStep);
      this.renderToBuffer({
        buffer: this.dataTexture.buffer,
        offset: bufferOffsetByTile(tile, tileSizeP),
        widthP: tileSizeP,
        rowDelta: 1 << constants.TEXTURE_SIZE_P,
      }, {
        buffer: this.NOT_LOADED_BUCKET_DATA,
        mapping: null,
        offset: 0,
        pixelDelta: 1,
        rowDelta: 1,
        pixelRepeatP: 0,
        rowRepeatP: 0,
      });
    } else if (Array.isArray(mapEntry)) {
      const bucket = mapEntry;
      const bucketZoomStep = bucket[3];
      tileSizeP = BUCKET_SIZE_P - (this.dataTexture.zoomStep - tileZoomStep);
      const skipP = Math.max(this.dataTexture.zoomStep - bucketZoomStep, 0);
      const repeatP = Math.max(bucketZoomStep - this.dataTexture.zoomStep, 0);
      const destOffset = bufferOffsetByTile(tile, tileSizeP);

      const offsetMask = (1 << (bucketZoomStep - tileZoomStep)) - 1;
      const scaleFactorP = BUCKET_SIZE_P - (bucketZoomStep - tileZoomStep);

      const sourceOffsets = [
        (((this.dataTexture.topLeftBucket[this.U] << (this.dataTexture.zoomStep - tileZoomStep)) + tile[0]) & offsetMask) << scaleFactorP,
        (((this.dataTexture.topLeftBucket[this.V] << (this.dataTexture.zoomStep - tileZoomStep)) + tile[1]) & offsetMask) << scaleFactorP,
        (this.dataTexture.layer >> bucketZoomStep) & ((1 << BUCKET_SIZE_P) - 1),
      ];

      const sourceOffset =
        (sourceOffsets[0] << Plane2DConstants.DELTA[this.U]) +
        (sourceOffsets[1] << Plane2DConstants.DELTA[this.V]) +
        (sourceOffsets[2] << Plane2DConstants.DELTA[this.W]);

      const bucketData = this.cube.getBucket(bucket).getData();
      const mapping = this.cube.currentMapping;

      this.renderToBuffer({
        buffer: this.dataTexture.buffer,
        offset: destOffset,
        widthP: tileSizeP,
        rowDelta: 1 << constants.TEXTURE_SIZE_P,
      }, {
        buffer: bucketData,
        mapping,
        offset: sourceOffset,
        pixelDelta: 1 << (Plane2DConstants.DELTA[this.U] + skipP),
        rowDelta: 1 << (Plane2DConstants.DELTA[this.V] + skipP),
        pixelRepeatP: repeatP,
        rowRepeatP: repeatP,
      });
    }
  }


  generateRenderMap([bucketX, bucketY, bucketZ, zoomStep]: Vector4): Array<RenderMapDescriptor> {
    let bucket = this.cube.getBucket([bucketX, bucketY, bucketZ, zoomStep]);
    if (bucket.hasData()) { return [[bucketX, bucketY, bucketZ, zoomStep]]; }
    if (bucket.isOutOfBoundingBox) { return [null]; }

    const map = new Array(this.MAP_SIZE);
    map[0] = Plane2DConstants.NOT_LOADED_BUCKET_PLACEHOLDER;

    const maxZoomStepOffset = Math.max(0, Math.min(this.cube.LOOKUP_DEPTH_UP,
      this.cube.ZOOM_STEP_COUNT - zoomStep - 1,
    ));

    if (zoomStep < this.cube.ZOOM_STEP_COUNT) {
      for (let i = maxZoomStepOffset; i > 0; i--) {
        bucket = [
          bucketX >> i,
          bucketY >> i,
          bucketZ >> i,
          zoomStep + i,
        ];

        if (this.cube.getBucket(bucket).hasData()) { map[0] = bucket; }
      }
    }

    if (zoomStep !== 0 && this.enhanceRenderMap(map, 0,
        [bucketX, bucketY, bucketZ, zoomStep], map[0], this.cube.LOOKUP_DEPTH_DOWN)) {
      map[0] = Plane2DConstants.RECURSION_PLACEHOLDER;
    }

    return map;
  }


  enhanceRenderMap(map: Array<RenderMapDescriptor>, mapIndex: number,
    [bucketX, bucketY, bucketZ, zoomStep]: Vector4,
    fallback: RenderMapDescriptor, level: number): boolean {
    let enhanced = false;
    const bucket = this.cube.getBucket([bucketX, bucketY, bucketZ, zoomStep]);

    if (bucket.hasData()) {
      map[mapIndex] = [bucketX, bucketY, bucketZ, zoomStep];
      enhanced = true;
    } else if (bucket.isOutOfBoundingBox && fallback === Plane2DConstants.NOT_LOADED_BUCKET_PLACEHOLDER) {
      map[mapIndex] = null;
      enhanced = true;
    } else {
      map[mapIndex] = fallback;
    }

    const dw = (this.dataTexture.layer >> ((BUCKET_SIZE_P + zoomStep) - 1)) & 0b1;

    let recursive = false;

    if (level && zoomStep) {
      for (let du = 0; du <= 1; du++) {
        for (let dv = 0; dv <= 1; dv++) {
          const subBucket = [bucketX << 1, bucketY << 1, bucketZ << 1, zoomStep - 1];
          subBucket[this.U] += du;
          subBucket[this.V] += dv;
          subBucket[this.W] += dw;

          if (this.enhanceRenderMap(map, (mapIndex << 2) + (2 * dv) + du + 1, subBucket, map[mapIndex], level - 1)) {
            recursive = true;
          }
        }
      }
    }

    if (recursive) {
      map[mapIndex] = Plane2DConstants.RECURSION_PLACEHOLDER;
      enhanced = true;
    }

    return enhanced;
  }


  renderToBuffer(destination: RenderBufferTarget, source: RenderBufferSource): void {
    let i = 1 << (destination.widthP << 1);
    const destinationNextRowMask = (1 << destination.widthP) - 1;
    const sourceNextPixelMask = (1 << source.pixelRepeatP) - 1;
    const sourceNextRowMask = (1 << (destination.widthP + source.rowRepeatP)) - 1;
    const { mapping } = source;

    const bytesSrc = this.DATA_BIT_DEPTH >> 3;
    const bytesSrcMapped = (mapping != null) && mapping.length ? this.MAPPED_DATA_BIT_DEPTH >> 3 : bytesSrc;
    const bytesDest = this.TEXTURE_BIT_DEPTH >> 3;
    const shorten = bytesDest < bytesSrcMapped;

    while (i--) {
      let dest = destination.offset++ * bytesDest;
      const src = source.offset * bytesSrc;

      let sourceValue = 0;
      for (let b = 0; b < bytesSrc; b++) {
        sourceValue += (1 << (b * 8)) * source.buffer[src + b];
      }
      sourceValue = (mapping != null) && (mapping[sourceValue] != null) ? mapping[sourceValue] : sourceValue;

      // If you have to shorten the data,
      // use the first none-zero byte unless all are zero
      // assuming little endian order
      for (let b = 0; b < bytesSrcMapped; b++) {
        const value = (sourceValue >> (b * 8)) % 256;
        if (value || b === bytesSrcMapped - 1 || (!shorten)) {
          destination.buffer[dest++] = value;
          if (shorten) {
            break;
          }
        }
      }

      if ((i & sourceNextPixelMask) === 0) {
        source.offset += source.pixelDelta;
      }

      if ((i & destinationNextRowMask) === 0) {
        destination.offset += destination.rowDelta - (1 << destination.widthP);
        source.offset -= source.pixelDelta << (destination.widthP - source.pixelRepeatP);
      }

      if ((i & sourceNextRowMask) === 0) {
        source.offset += source.rowDelta;
      }
    }
  }
}

export default Plane2D;
