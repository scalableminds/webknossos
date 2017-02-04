/**
 * binary.js
 * @flow weak
 */

import _ from "lodash";
import Backbone from "backbone";
import Pipeline from "libs/pipeline";
import InterpolationCollector from "oxalis/model/binary/interpolation_collector";
import DataCube from "oxalis/model/binary/data_cube";
import PullQueue, { PullQueueConstants } from "oxalis/model/binary/pullqueue";
import PushQueue from "oxalis/model/binary/pushqueue";
import Plane2D from "oxalis/model/binary/plane2d";
import PingStrategy from "oxalis/model/binary/ping_strategy";
import PingStrategy3d from "oxalis/model/binary/ping_strategy_3d";
import Mappings from "oxalis/model/binary/mappings";
import constants from "oxalis/constants";
import Model from "oxalis/model";
import ConnectionInfo from "oxalis/model/binarydata_connection_info";

import type { Vector3, Vector4 } from "oxalis/constants";
import type { Tracing } from "oxalis/model";
import type { CategoryType } from "oxalis/model/binary/layers/layer";

const PING_THROTTLE_TIME = 50;
const DIRECTION_VECTOR_SMOOTHER = 0.125;

class Binary {

  model: Model;
  cube: DataCube;
  tracing: Tracing;
  layer: Object;
  category: CategoryType;
  name: String;
  targetBitDepth: number;
  lowerBoundary: Vector3;
  upperBoundary: Vector3;
  connectionInfo: ConnectionInfo;
  pullQueue: PullQueue;
  pushQueue: PushQueue;
  mappings: Mappings;
  pingStrategies: Array<PingStrategy>;
  pingStrategies3d: Array<PingStrategy3d>;
  planes: Array<Plane2D>;
  direction: Vector3;
  activeMapping: String | null;
  lastPosition: Vector3 | null;
  lastZoomStep: number | null;
  lastAreas: Array<Vector4> | null;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(model, tracing, layer, maxZoomStep, connectionInfo) {
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

    const updatePipeline = new Pipeline([this.tracing.version]);

    const datasetName = this.model.get("dataset").get("name");
    const datastoreInfo = this.model.get("dataset").get("dataStore");
    this.pullQueue = new PullQueue(this.cube, this.layer, this.connectionInfo, datastoreInfo);
    this.pushQueue = new PushQueue(datasetName, this.cube, this.layer, this.tracing.id, updatePipeline);
    this.cube.initializeWithQueues(this.pullQueue, this.pushQueue);
    this.mappings = new Mappings(datastoreInfo, datasetName, this.layer);
    this.activeMapping = null;
    this.direction = [0, 0, 0];

    this.pingStrategies = [
      new PingStrategy.Skeleton(this.cube, constants.TEXTURE_SIZE_P),
      new PingStrategy.Volume(this.cube, constants.TEXTURE_SIZE_P),
    ];
    this.pingStrategies3d = [
      new PingStrategy3d.DslSlow(),
    ];

    this.planes = [];
    for (const planeId of constants.ALL_PLANES) {
      this.planes.push(new Plane2D(planeId, this.cube, this.layer.bitDepth, this.targetBitDepth,
                                32, this.category === "segmentation"));
    }

    if (this.layer.dataStoreInfo.typ === "webknossos-store") {
      this.layer.setFourBit(this.model.get("datasetConfiguration").get("fourBit"));
      this.listenTo(this.model.get("datasetConfiguration"), "change:fourBit",
                function (datasetModel, fourBit) { this.layer.setFourBit(fourBit); });
    }

    this.cube.on({
      newMapping: () => this.forcePlaneRedraw(),
    });
  }


  forcePlaneRedraw() {
    this.planes.forEach(plane =>
      plane.forceRedraw());
  }


  setActiveMapping(mappingName) {
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


  pingStop() {
    this.pullQueue.clearNormalPriorities();
  }


  ping = _.throttle(this.pingImpl, PING_THROTTLE_TIME);


  pingImpl(position, { zoomStep, areas, activePlane }) {
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
      this.lastAreas = areas.slice();

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


  arbitraryPingImpl(matrix, zoomStep) {
    for (const strategy of this.pingStrategies3d) {
      if (strategy.forContentType(this.tracing.contentType) && strategy.inVelocityRange(1) && strategy.inRoundTripTimeRange(this.pullQueue.roundTripTime)) {
        this.pullQueue.clearNormalPriorities();
        this.pullQueue.addAll(strategy.ping(matrix, zoomStep));
        break;
      }
    }

    this.pullQueue.pull();
  }


  arbitraryPing = _.once(function (matrix, zoomStep) {
    this.arbitraryPing = _.throttle(this.arbitraryPingImpl, PING_THROTTLE_TIME);
    this.arbitraryPing(matrix, zoomStep);
  });


  getByVerticesSync(vertices) {
    // A synchronized implementation of `get`. Cuz its faster.

    const { buffer, missingBuckets } = InterpolationCollector.bulkCollect(
      vertices,
      this.cube.getArbitraryCube(),
    );

    this.pullQueue.addAll(missingBuckets.map(
      bucket =>
        ({
          bucket,
          priority: PullQueueConstants.PRIORITY_HIGHEST,
        }),
    ));
    this.pullQueue.pull();

    return buffer;
  }
}

export default Binary;
