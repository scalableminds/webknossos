import _ from "lodash";
import Backbone from "backbone";
import Dimensions from "../dimensions";

// Macros
// should work as normal functions, as well
const tileIndexByTileMacro = (_this, tile) => (tile[0] * (1 << (_this.TEXTURE_SIZE_P - _this.cube.BUCKET_SIZE_P))) + tile[1];


const subTileMacro = (tile, index) => [(tile[0] << 1) + (index % 2), (tile[1] << 1) + (index >> 1)];


const bufferOffsetByTileMacro = (_this, tile, tileSize) => (tile[0] * (1 << tileSize)) + (tile[1] * (1 << tileSize) * (1 << _this.TEXTURE_SIZE_P));


class Plane2D {
  static initClass() {
    // Constants
    this.prototype.TEXTURE_SIZE_P = 0;
    this.prototype.BUCKETS_PER_ROW = 0;
    this.prototype.MAP_SIZE = 0;
    this.prototype.RECURSION_PLACEHOLDER = { recursionPlaceholder: true };
    this.prototype.DELTA = [0, 5, 10];
    this.prototype.U = 0;
    this.prototype.V = 0;
    this.prototype.W = 0;

    this.prototype.NOT_LOADED_BUCKET_INTENSITY = 100;
    this.prototype.NOT_LOADED_BUCKET_PLACEHOLDER = { notLoadedBucketPlaceholder: true };

    this.prototype.cube = null;
    this.prototype.queue = null;

    this.prototype.dataTexture = null;
  }


  constructor(index, cube, queue, TEXTURE_SIZE_P, DATA_BIT_DEPTH,
    TEXTURE_BIT_DEPTH, MAPPED_DATA_BIT_DEPTH, isSegmentation) {
    this.index = index;
    this.cube = cube;
    this.queue = queue;
    this.TEXTURE_SIZE_P = TEXTURE_SIZE_P;
    this.DATA_BIT_DEPTH = DATA_BIT_DEPTH;
    this.TEXTURE_BIT_DEPTH = TEXTURE_BIT_DEPTH;
    this.MAPPED_DATA_BIT_DEPTH = MAPPED_DATA_BIT_DEPTH;
    _.extend(this, Backbone.Events);

    this.BUCKETS_PER_ROW = 1 << (this.TEXTURE_SIZE_P - this.cube.BUCKET_SIZE_P);
    this.TEXTURE_SIZE = (1 << (this.TEXTURE_SIZE_P << 1)) * (this.TEXTURE_BIT_DEPTH >> 3);

    if (isSegmentation) {
      this.NOT_LOADED_BUCKET_INTENSITY = 0;
    }
    this.NOT_LOADED_BUCKET_DATA = new Uint8Array(this.cube.BUCKET_LENGTH);
    for (let i = 0; i < this.NOT_LOADED_BUCKET_DATA.length; i++) {
      this.NOT_LOADED_BUCKET_DATA[i] = this.NOT_LOADED_BUCKET_INTENSITY;
    }

    this.forceRedraw = false;

    for (let i = 0; i <= this.cube.LOOKUP_DEPTH_DOWN; i++) {
      this.MAP_SIZE += 1 << (i << 1);
    }

    [this.U, this.V, this.W] = Dimensions.getIndices(this.index);

    this.dataTexture = { renderTile: this.renderDataTile };

    this.listenTo(this.cube, "bucketLoaded", function (bucket) {
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
      if (this.dataTexture.layer >> (this.cube.BUCKET_SIZE_P + bucket[3]) === bucket[this.W] &&
          (this.dataTexture.topLeftBucket != null)) {
        // Get the tile, the bucket would be drawn to
        const u = bucket[this.U] - this.dataTexture.topLeftBucket[this.U];
        const v = bucket[this.V] - this.dataTexture.topLeftBucket[this.V];

        // If the tile is part of the texture, mark it as changed
        if ((__range__(0, this.BUCKETS_PER_ROW, false)).includes(u) &&
            (__range__(0, this.BUCKETS_PER_ROW, false)).includes(v)) {
          const tile = [u, v];
          this.dataTexture.tiles[tileIndexByTileMacro(this, tile)] = false;
          return this.dataTexture.ready &=
            !((__range__(this.dataTexture.area[0], this.dataTexture.area[2], true)).includes(u) &&
              (__range__(this.dataTexture.area[1], this.dataTexture.area[3], true)).includes(v));
        }
      }
    });

    this.cube.on("volumeLabeled", () => this.reset());
    this.cube.on("mappingChanged", () => this.reset());
  }


  reset() {
    this.dataTexture.tiles = new Array(this.BUCKETS_PER_ROW * this.BUCKETS_PER_ROW);
    this.dataTexture.ready = false;
  }


  forceRedraw() {
    this.forceRedraw = true;
  }


  hasChanged() {
    return !this.dataTexture.ready;
  }


  get({ position, zoomStep, area }) {
    return this.getTexture(this.dataTexture, position, zoomStep, area);
  }


  getTexture(texture, position, zoomStep, area) {
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
    topLeftPosition[this.U] -= 1 << ((this.TEXTURE_SIZE_P - 1) + zoomStep);
    topLeftPosition[this.V] -= 1 << ((this.TEXTURE_SIZE_P - 1) + zoomStep);

    const topLeftBucket = this.cube.positionToZoomedAddress(topLeftPosition, zoomStep);

    // Converting area from voxels to buckets
    area = [
      area[0] >> this.cube.BUCKET_SIZE_P,
      area[1] >> this.cube.BUCKET_SIZE_P,
      (area[2] - 1) >> this.cube.BUCKET_SIZE_P,
      (area[3] - 1) >> this.cube.BUCKET_SIZE_P,
    ];

    // If layer or zoomStep have changed, everything needs to be redrawn
    if (this.forceRedraw || !_.isEqual(texture.layer, layer) || !_.isEqual(texture.zoomStep, zoomStep)) {
      texture.layer = layer;
      texture.zoomStep = zoomStep;
      texture.topLeftBucket = topLeftBucket;
      texture.area = area;

      texture.tiles = new Array(this.BUCKETS_PER_ROW * this.BUCKETS_PER_ROW);
      texture.buffer = new Uint8Array(this.TEXTURE_SIZE);
      texture.ready = false;

      this.forceRedraw = false;
    }

    // If the top-left-bucket has changed, still visible tiles are copied to their new location
    if (!_.isEqual(texture.topLeftBucket, topLeftBucket)) {
      const oldTopLeftBucket = texture.topLeftBucket;
      texture.topLeftBucket = topLeftBucket;

      texture.tiles = new Array(this.BUCKETS_PER_ROW * this.BUCKETS_PER_ROW);
      texture.buffer = new Uint8Array(this.TEXTURE_SIZE);
      texture.ready = false;

      // Calculating boundaries for copying
      const width = (1 << (this.TEXTURE_SIZE_P - this.cube.BUCKET_SIZE_P)) - Math.abs(texture.topLeftBucket[this.U] - oldTopLeftBucket[this.U]);
      const height = (1 << (this.TEXTURE_SIZE_P - this.cube.BUCKET_SIZE_P)) - Math.abs(texture.topLeftBucket[this.V] - oldTopLeftBucket[this.V]);
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

          tileIndexByTileMacro(this, oldTile);
          tileIndexByTileMacro(this, newTile);
        }
      }
    }

          // if oldTiles[oldTileIndex]
          //  @copyTile(newTile, oldTile, texture.buffer, oldBuffer)
          //  texture.tiles[newTileIndex] = true

    // If something has changed, only changed tiles are drawn
    if (!texture.ready || !_.isEqual(texture.area, area)) {
      texture.ready = true;
      texture.area = area;

      // Tiles are rendered from the bottom-right to the top-left corner
      // to make linear interpolation possible in the future
      for (let u = area[2]; u >= area[0]; u--) {
        for (let v = area[3]; v >= area[1]; v--) {
          const tile = [u, v];
          const tileIndex = tileIndexByTileMacro(this, tile);

          // Render tile if necessary and mark it as rendered
          if (!texture.tiles[tileIndex]) {
            texture.renderTile.call(this, tile);
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


  copyTile(destTile, sourceTile, destBuffer, sourceBuffer) {
    const destOffset = bufferOffsetByTileMacro(this, destTile, this.cube.BUCKET_SIZE_P);
    const sourceOffset = bufferOffsetByTileMacro(this, sourceTile, this.cube.BUCKET_SIZE_P);

    return this.renderToBuffer(
      {
        buffer: destBuffer,
        offset: destOffset,
        widthP: this.cube.BUCKET_SIZE_P,
        rowDelta: 1 << this.TEXTURE_SIZE_P,
      },
      {
        buffer: sourceBuffer,
        offset: sourceOffset,
        pixelDelta: 1,
        rowDelta: 1 << this.TEXTURE_SIZE_P,
        pixelRepeatP: 0,
        rowRepeatP: 0,
      },
      null,
    );
  }


  renderDataTile(tile) {
    const bucket = this.dataTexture.topLeftBucket.slice(0);
    bucket[this.U] += tile[0];
    bucket[this.V] += tile[1];

    const map = this.generateRenderMap(bucket);

    return this.renderSubTile(map, 0, tile, this.dataTexture.zoomStep);
  }


  renderSubTile(map, mapIndex, tile, tileZoomStep) {
    let tileSizeP;
    if (!map[mapIndex]) { return; }

    if (map[mapIndex] === this.RECURSION_PLACEHOLDER) {
      const result = new Array(4);
      for (let i = 0; i <= 3; i++) {
        const subTile = subTileMacro(tile, i);
        result[i] = this.renderSubTile(map, (mapIndex << 2) + 1 + i, subTile, tileZoomStep - 1);
      }
      return result;
    } else if (map[mapIndex] === this.NOT_LOADED_BUCKET_PLACEHOLDER) {
      tileSizeP = this.cube.BUCKET_SIZE_P - (this.dataTexture.zoomStep - tileZoomStep);
      return this.renderToBuffer(
        {
          buffer: this.dataTexture.buffer,
          offset: bufferOffsetByTileMacro(this, tile, tileSizeP),
          widthP: tileSizeP,
          rowDelta: 1 << this.TEXTURE_SIZE_P,
        },
        {
          buffer: this.NOT_LOADED_BUCKET_DATA,
          mapping: null,
          offset: 0,
          pixelDelta: 1,
          rowDelta: 1,
          pixelRepeatP: 0,
          rowRepeatP: 0,
        },
      );
    } else {
      const bucket = map[mapIndex];
      const bucketZoomStep = bucket[3];
      tileSizeP = this.cube.BUCKET_SIZE_P - (this.dataTexture.zoomStep - tileZoomStep);
      const skipP = Math.max(this.dataTexture.zoomStep - bucketZoomStep, 0);
      const repeatP = Math.max(bucketZoomStep - this.dataTexture.zoomStep, 0);
      const destOffset = bufferOffsetByTileMacro(this, tile, tileSizeP);

      const offsetMask = (1 << (bucketZoomStep - tileZoomStep)) - 1;
      const scaleFactorP = this.cube.BUCKET_SIZE_P - (bucketZoomStep - tileZoomStep);

      const sourceOffsets = [
        (((this.dataTexture.topLeftBucket[this.U] << (this.dataTexture.zoomStep - tileZoomStep)) + tile[0]) & offsetMask) << scaleFactorP,
        (((this.dataTexture.topLeftBucket[this.V] << (this.dataTexture.zoomStep - tileZoomStep)) + tile[1]) & offsetMask) << scaleFactorP,
        (this.dataTexture.layer >> bucketZoomStep) & ((1 << this.cube.BUCKET_SIZE_P) - 1),
      ];

      const sourceOffset =
        (sourceOffsets[0] << this.DELTA[this.U]) +
        (sourceOffsets[1] << this.DELTA[this.V]) +
        (sourceOffsets[2] << this.DELTA[this.W]);

      const bucketData = this.cube.getBucket(bucket).getData();
      const mapping = this.cube.currentMapping;

      return this.renderToBuffer(
        {
          buffer: this.dataTexture.buffer,
          offset: destOffset,
          widthP: tileSizeP,
          rowDelta: 1 << this.TEXTURE_SIZE_P,
        },
        {
          buffer: bucketData,
          mapping,
          offset: sourceOffset,
          pixelDelta: 1 << (this.DELTA[this.U] + skipP),
          rowDelta: 1 << (this.DELTA[this.V] + skipP),
          pixelRepeatP: repeatP,
          rowRepeatP: repeatP,
        },
      );
    }
  }


  generateRenderMap([bucketX, bucketY, bucketZ, zoomStep]) {
    let bucket = this.cube.getBucket([bucketX, bucketY, bucketZ, zoomStep]);
    if (bucket.hasData()) { return [[bucketX, bucketY, bucketZ, zoomStep]]; }
    if (bucket.isOutOfBoundingBox) { return [undefined]; }

    const map = new Array(this.MAP_SIZE);
    map[0] = this.NOT_LOADED_BUCKET_PLACEHOLDER;

    const maxZoomStepOffset = Math.max(0, Math.min(this.cube.LOOKUP_DEPTH_UP,
      this.cube.ZOOM_STEP_COUNT - zoomStep - 1,
    ));

    if (zoomStep < this.cube.ZOOM_STEP_COUNT) {
      // TODO
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
      map[0] = this.RECURSION_PLACEHOLDER;
    }

    return map;
  }


  enhanceRenderMap(map, mapIndex, [bucketX, bucketY, bucketZ, zoomStep], fallback, level) {
    let enhanced = false;
    const bucket = this.cube.getBucket([bucketX, bucketY, bucketZ, zoomStep]);

    if (bucket.hasData()) {
      map[mapIndex] = [bucketX, bucketY, bucketZ, zoomStep];
      enhanced = true;
    } else if (bucket.isOutOfBoundingBox && fallback === this.NOT_LOADED_BUCKET_PLACEHOLDER) {
      map[mapIndex] = undefined;
      enhanced = true;
    } else {
      map[mapIndex] = fallback;
    }

    const dw = (this.dataTexture.layer >> ((this.cube.BUCKET_SIZE_P + zoomStep) - 1)) & 0b1;

    let recursive = false;

    if (level && zoomStep) {
      for (let du = 0; du <= 1; du++) {
        for (let dv = 0; dv <= 1; dv++) {
          const subBucket = [bucketX << 1, bucketY << 1, bucketZ << 1, zoomStep - 1];
          subBucket[this.U] += du;
          subBucket[this.V] += dv;
          subBucket[this.W] += dw;

          recursive |= this.enhanceRenderMap(map, (mapIndex << 2) + (2 * dv) + du + 1, subBucket, map[mapIndex], level - 1);
        }
      }
    }

    if (recursive) {
      map[mapIndex] = this.RECURSION_PLACEHOLDER;
      enhanced = true;
    }

    return enhanced;
  }


  renderToBuffer(destination, source) {
    let i = 1 << (destination.widthP << 1);
    destination.nextRowMask = (1 << destination.widthP) - 1;
    source.nextPixelMask = (1 << source.pixelRepeatP) - 1;
    source.nextRowMask = (1 << (destination.widthP + source.rowRepeatP)) - 1;

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
        let value;
        if ((value = (sourceValue >> (b * 8)) % 256) || b === bytesSrcMapped - 1 || (!shorten)) {
          destination.buffer[dest++] = value;
          if (shorten) {
            break;
          }
        }
      }

      if ((i & source.nextPixelMask) === 0) {
        source.offset += source.pixelDelta;
      }

      if ((i & destination.nextRowMask) === 0) {
        destination.offset += destination.rowDelta - (1 << destination.widthP);
        source.offset -= source.pixelDelta << (destination.widthP - source.pixelRepeatP);
      }

      if ((i & source.nextRowMask) === 0) {
        source.offset += source.rowDelta;
      }
    }
  }
}
Plane2D.initClass();

export default Plane2D;

function __range__(left, right, inclusive) {
  const range = [];
  const ascending = left < right;
  const end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
