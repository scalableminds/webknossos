import _ from "lodash";
import Backbone from "backbone";
import Pipeline from "libs/pipeline";
import InterpolationCollector from "./binary/interpolation_collector";
import Cube from "./binary/cube";
import PullQueue from "./binary/pullqueue";
import PushQueue from "./binary/pushqueue";
import Plane2D from "./binary/plane2d";
import PingStrategy from "./binary/ping_strategy";
import PingStrategy3d from "./binary/ping_strategy_3d";
import Mappings from "./binary/mappings";
import constants from "../constants";

class Binary {
  static initClass() {
    // Constants
    this.prototype.PING_THROTTLE_TIME = 50;
    this.prototype.DIRECTION_VECTOR_SMOOTHER = 0.125;
    this.prototype.TEXTURE_SIZE_P = 0;

    this.prototype.cube = null;
    this.prototype.pullQueue = null;
    this.prototype.planes = [];

    this.prototype.direction = [0, 0, 0];


    this.prototype.arbitraryPing = _.once(function (matrix, zoomStep) {
      this.arbitraryPing = _.throttle(this.arbitraryPingImpl, this.PING_THROTTLE_TIME);
      return this.arbitraryPing(matrix, zoomStep);
    });
  }

  constructor(model, tracing, layer, maxZoomStep, connectionInfo) {
    this.model = model;
    this.tracing = tracing;
    this.layer = layer;
    this.connectionInfo = connectionInfo;
    _.extend(this, Backbone.Events);

    this.TEXTURE_SIZE_P = constants.TEXTURE_SIZE_P;
    this.category = this.layer.category;
    this.name = this.layer.name;

    this.targetBitDepth = this.category === "color" ? this.layer.bitDepth : 8;

    const { topLeft, width, height, depth } = this.layer.maxCoordinates;
    this.lowerBoundary = this.layer.lowerBoundary = topLeft;
    this.upperBoundary = this.layer.upperBoundary = [topLeft[0] + width, topLeft[1] + height, topLeft[2] + depth];

    this.cube = new Cube(this.model.taskBoundingBox, this.upperBoundary, maxZoomStep + 1, this.layer.bitDepth);

    const updatePipeline = new Pipeline([this.tracing.version]);

    const datasetName = this.model.get("dataset").get("name");
    const datastoreInfo = this.model.get("dataset").get("dataStore");
    this.pullQueue = new PullQueue(this.cube, this.layer, this.connectionInfo, datastoreInfo);
    this.pushQueue = new PushQueue(datasetName, this.cube, this.layer, this.tracing.id, updatePipeline);
    this.cube.initializeWithQueues(this.pullQueue, this.pushQueue);
    this.mappings = new Mappings(datasetName, this.layer);
    this.activeMapping = null;

    this.pingStrategies = [
      new PingStrategy.Skeleton(this.cube, this.TEXTURE_SIZE_P),
      new PingStrategy.Volume(this.cube, this.TEXTURE_SIZE_P),
    ];
    this.pingStrategies3d = [
      new PingStrategy3d.DslSlow(),
    ];

    this.planes = [];
    for (const planeId of constants.ALL_PLANES) {
      this.planes.push(new Plane2D(planeId, this.cube, this.pullQueue, this.TEXTURE_SIZE_P, this.layer.bitDepth, this.targetBitDepth,
                                32, this.category === "segmentation"));
    }

    if (this.layer.dataStoreInfo.typ === "webknossos-store") {
      this.layer.setFourBit(this.model.get("datasetConfiguration").get("fourBit"));
      this.listenTo(this.model.get("datasetConfiguration"), "change:fourBit",
                function (model, fourBit) { return this.layer.setFourBit(fourBit); });
    }

    this.cube.on({
      newMapping: () => this.forcePlaneRedraw(),
    });

    this.ping = _.throttle(this.pingImpl, this.PING_THROTTLE_TIME);
  }


  forcePlaneRedraw() {
    return this.planes.map(plane =>
      plane.forceRedraw());
  }


  setActiveMapping(mappingName) {
    this.activeMapping = mappingName;

    const setMapping = (mapping) => {
      this.cube.setMapping(mapping);
      return this.model.flycam.update();
    };

    if (mappingName != null) {
      return this.mappings.getMappingArrayAsync(mappingName).then(setMapping);
    } else {
      return setMapping([]);
    }
  }

  pingStop() {
    return this.pullQueue.clearNormalPriorities();
  }


  pingImpl(position, { zoomStep, area, activePlane }) {
    if (this.lastPosition != null) {
      this.direction = [
        ((1 - this.DIRECTION_VECTOR_SMOOTHER) * this.direction[0]) + (this.DIRECTION_VECTOR_SMOOTHER * (position[0] - this.lastPosition[0])),
        ((1 - this.DIRECTION_VECTOR_SMOOTHER) * this.direction[1]) + (this.DIRECTION_VECTOR_SMOOTHER * (position[1] - this.lastPosition[1])),
        ((1 - this.DIRECTION_VECTOR_SMOOTHER) * this.direction[2]) + (this.DIRECTION_VECTOR_SMOOTHER * (position[2] - this.lastPosition[2])),
      ];
    }

    if (!_.isEqual(position, this.lastPosition) || zoomStep !== this.lastZoomStep || !_.isEqual(area, this.lastArea)) {
      this.lastPosition = position.slice();
      this.lastZoomStep = zoomStep;
      this.lastArea = area.slice();

      for (const strategy of this.pingStrategies) {
        if (strategy.forContentType(this.tracing.contentType) && strategy.inVelocityRange(this.connectionInfo.bandwidth) && strategy.inRoundTripTimeRange(this.connectionInfo.roundTripTime)) {
          if ((zoomStep != null) && (area != null) && (activePlane != null)) {
            this.pullQueue.clearNormalPriorities();
            this.pullQueue.addAll(strategy.ping(position, this.direction, zoomStep, area, activePlane));
          }
          break;
        }
      }

      return this.pullQueue.pull();
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

    return this.pullQueue.pull();
  }


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
          priority: PullQueue.prototype.PRIORITY_HIGHEST,
        }),
    ));
    this.pullQueue.pull();

    return buffer;
  }
}
Binary.initClass();

export default Binary;
