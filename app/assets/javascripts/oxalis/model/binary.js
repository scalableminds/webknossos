/**
 * binary.js
 * @flow
 */

import _ from "lodash";
import Backbone from "backbone";
import AsyncTaskQueue from "libs/async_task_queue";
import InterpolationCollector from "oxalis/model/binary/interpolation_collector";
import DataCube from "oxalis/model/binary/data_cube";
import PullQueue, { PullQueueConstants } from "oxalis/model/binary/pullqueue";
import PushQueue from "oxalis/model/binary/pushqueue";
import Plane2D from "oxalis/model/binary/plane2d";
import { PingStrategy, SkeletonPingStrategy, VolumePingStrategy } from "oxalis/model/binary/ping_strategy";
import { PingStrategy3d, DslSlowPingStrategy3d } from "oxalis/model/binary/ping_strategy_3d";
import Mappings from "oxalis/model/binary/mappings";
import { OrthoViews } from "oxalis/constants";
import Model from "oxalis/model";
import ConnectionInfo from "oxalis/model/binarydata_connection_info";

import type { Vector3, Vector4, OrthoViewMapType, OrthoViewType } from "oxalis/constants";
import type { Matrix4x4 } from "libs/mjs";
import type { Tracing } from "oxalis/model";
import type Layer, { CategoryType } from "oxalis/model/binary/layers/layer";

const PING_THROTTLE_TIME = 50;
const DIRECTION_VECTOR_SMOOTHER = 0.125;

type PingOptions = {
  zoomStep: number;
  areas: OrthoViewMapType<Vector4>;
  activePlane: OrthoViewType;
};

class Binary {

  model: Model;
  cube: DataCube;
  tracing: Tracing;
  layer: Layer;
  category: CategoryType;
  name: string;
  targetBitDepth: number;
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  connectionInfo: ConnectionInfo;
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  mappings: Mappings;
  pingStrategies: Array<PingStrategy>;
  pingStrategies3d: Array<PingStrategy3d>;
  planes: OrthoViewMapType<Plane2D>;
  direction: Vector3;
  activeMapping: ?string;
  lastPosition: ?Vector3;
  lastZoomStep: ?number;
  lastAreas: ?OrthoViewMapType<Vector4>;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(model: Model, tracing: Tracing, layer: Layer, maxZoomStep: number, connectionInfo: ConnectionInfo) {
    this.model = model;
    this.tracing = tracing;
    this.layer = layer;
    this.connectionInfo = connectionInfo;
    _.extend(this, Backbone.Events);

    this.category = this.layer.category;
    this.name = this.layer.name;

    this.targetBitDepth = this.category === "color" ? this.layer.bitDepth : 8;

    const { topLeft, width, height, depth } = this.layer.maxCoordinates;
    this.lowerBoundary = this.layer.lowerBoundary = topLeft;
    this.upperBoundary = this.layer.upperBoundary = [topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth];

    this.cube = new DataCube(this.model.taskBoundingBox, this.upperBoundary, maxZoomStep + 1, this.layer.bitDepth);

    const taskSerializer = new AsyncTaskQueue();

    const datasetName = this.model.get("dataset").get("name");
    const datastoreInfo = this.model.get("dataset").get("dataStore");
    this.pullQueue = new PullQueue(this.cube, this.layer, this.connectionInfo, datastoreInfo);
    this.pushQueue = new PushQueue(datasetName, this.cube, this.layer, this.tracing.id, taskSerializer);
    this.cube.initializeWithQueues(this.pullQueue, this.pushQueue);
    this.mappings = new Mappings(datastoreInfo, datasetName, this.layer);
    this.activeMapping = null;
    this.direction = [0, 0, 0];

    this.pingStrategies = [
      new SkeletonPingStrategy(this.cube),
      new VolumePingStrategy(this.cube),
    ];
    this.pingStrategies3d = [
      new DslSlowPingStrategy3d(this.cube),
    ];

    this.planes = {};
    for (const planeId of Object.keys(OrthoViews)) {
      this.planes[planeId] = new Plane2D(planeId, this.cube,
        this.layer.bitDepth, this.targetBitDepth, 32, this.category === "segmentation");
    }

    if (this.layer.dataStoreInfo.typ === "webknossos-store") {
      this.layer.setFourBit(this.model.get("datasetConfiguration").get("fourBit"));
      this.listenTo(this.model.get("datasetConfiguration"), "change:fourBit",
                (datasetModel, fourBit) => { this.layer.setFourBit(fourBit); });
    }

    this.cube.on({
      newMapping: () => this.forcePlaneRedraw(),
    });
  }


  forcePlaneRedraw(): void {
    for (const plane of _.values(this.planes)) {
      plane.forceRedraw();
    }
  }


  setActiveMapping(mappingName: string): void {
    this.activeMapping = mappingName;

    const setMapping = (mapping) => {
      this.cube.setMapping(mapping);
      this.model.flycam.update();
    };

    if (mappingName != null) {
      this.mappings.getMappingArrayAsync(mappingName).then(setMapping);
    } else {
      setMapping([]);
    }
  }


  pingStop(): void {
    this.pullQueue.clearNormalPriorities();
  }


  ping = _.throttle(this.pingImpl, PING_THROTTLE_TIME);


  pingImpl(position: Vector3, { zoomStep, areas, activePlane }: PingOptions): void {
    if (this.lastPosition != null) {
      this.direction = [
        ((1 - DIRECTION_VECTOR_SMOOTHER) * this.direction[0]) + (DIRECTION_VECTOR_SMOOTHER * (position[0] - this.lastPosition[0])),
        ((1 - DIRECTION_VECTOR_SMOOTHER) * this.direction[1]) + (DIRECTION_VECTOR_SMOOTHER * (position[1] - this.lastPosition[1])),
        ((1 - DIRECTION_VECTOR_SMOOTHER) * this.direction[2]) + (DIRECTION_VECTOR_SMOOTHER * (position[2] - this.lastPosition[2])),
      ];
    }

    if (!_.isEqual(position, this.lastPosition) || zoomStep !== this.lastZoomStep || !_.isEqual(areas, this.lastAreas)) {
      this.lastPosition = position.slice();
      this.lastZoomStep = zoomStep;
      this.lastAreas = Object.assign({}, areas);

      for (const strategy of this.pingStrategies) {
        if (strategy.forContentType(this.tracing.contentType) && strategy.inVelocityRange(this.connectionInfo.bandwidth) && strategy.inRoundTripTimeRange(this.connectionInfo.roundTripTime)) {
          if ((zoomStep != null) && (areas != null) && (activePlane != null)) {
            this.pullQueue.clearNormalPriorities();
            this.pullQueue.addAll(strategy.ping(position, this.direction, zoomStep, areas, activePlane));
          }
          break;
        }
      }

      this.pullQueue.pull();
    }
  }


  arbitraryPingImpl(matrix: Matrix4x4, zoomStep: number): void {
    for (const strategy of this.pingStrategies3d) {
      if (strategy.forContentType(this.tracing.contentType) && strategy.inVelocityRange(1) && strategy.inRoundTripTimeRange(this.pullQueue.roundTripTime)) {
        this.pullQueue.clearNormalPriorities();
        this.pullQueue.addAll(strategy.ping(matrix, zoomStep));
        break;
      }
    }

    this.pullQueue.pull();
  }


  arbitraryPing = _.once(function (matrix: Matrix4x4, zoomStep: number) {
    this.arbitraryPing = _.throttle(this.arbitraryPingImpl, PING_THROTTLE_TIME);
    this.arbitraryPing(matrix, zoomStep);
  });


  getByVerticesSync(vertices: Array<number>): Uint8Array {
    // A synchronized implementation of `get`. Cuz its faster.

    const { buffer, missingBuckets } = InterpolationCollector.bulkCollect(
      vertices,
      this.cube.getArbitraryCube(),
    );

    this.pullQueue.addAll(missingBuckets.map(bucket => ({
      bucket,
      priority: PullQueueConstants.PRIORITY_HIGHEST,
    })));
    this.pullQueue.pull();

    return buffer;
  }
}

export default Binary;
