mockRequire = require("mock-require")
sinon = require("sinon")
_ = require("lodash")

mockRequire.stopAll()

makeModelMock = ->
  class ModelMock
    fetch : sinon.stub()
  ModelMock::fetch.returns(Promise.resolve())
  return ModelMock

User = makeModelMock()
DatasetConfiguration = makeModelMock()
Request = { receiveJSON : sinon.stub() }
ErrorHandling = {
  assertExtendContext : _.noop
  assert : _.noop
}
class Binary
  category : "color"
  lowerBoundary : [1, 2, 3]
  upperBoundary : [4, 5, 6]
class Flycam2d
  setPosition : ->
class Layer
  constructor : ->

mockRequire("../../libs/toast", { error : _.noop })
mockRequire("../../libs/request", Request)
mockRequire("../../libs/error_handling", ErrorHandling)
mockRequire("../../app", {})
mockRequire("../../oxalis/model/binary", Binary)
mockRequire("../../oxalis/model/scaleinfo", _.noop)
mockRequire("../../oxalis/model/flycam2d", Flycam2d)
mockRequire("../../oxalis/model/flycam3d", _.noop)
mockRequire("../../oxalis/model/skeletontracing/skeletontracing", _.noop)
mockRequire("../../oxalis/model/volumetracing/volumetracing", _.noop)
mockRequire("../../oxalis/model/user", User)
mockRequire("../../oxalis/model/dataset_configuration", DatasetConfiguration)
mockRequire("../../oxalis/model/binary/layers/wk_layer", Layer)
mockRequire("../../oxalis/model/binary/layers/nd_store_layer", Layer)

TRACING_OBJECT = {
  content :
    dataSet :
      name : "DatasetName"
      dataStore :
        url : "dataStoreUrl"
        typ : "webknossos-store"
      dataLayers : [
        name : "layer1"
        category : "color"
        elementClass : "Uint32"
        resolutions : [1]
      ]
    settings :
      allowedModes : []
    contentData :
      customLayers : []
}

Model = require("../../oxalis/model")

describe "Model", ->

  model = null


  beforeEach ->

    model = new Model()
    model.set("state", {position: [1, 2, 3]})


  describe "Initialization", ->

    beforeEach ->

      Request.receiveJSON.returns(Promise.resolve(TRACING_OBJECT))
      User.prototype.fetch.returns(Promise.resolve())

    describe "Successful initialization", ->

      it "should resolve", (done) ->

        model.fetch()
          .then(done)
          .catch((error) =>
            @fail(error.message)
            done()
          )

    describe "Error handling", ->

      it "should throw a Model::HANDLED_ERROR for missing dataset", (done) ->

        tracingObject = _.clone(TRACING_OBJECT)
        delete tracingObject.content.dataSet
        Request.receiveJSON.returns(Promise.resolve(tracingObject))

        model.fetch()
          .then(=>
            @fail("Promise should not have been resolved.")
            done()
          ).catch( (error) ->
            expect(error).toBe(Model::HANDLED_ERROR)
            done()
          )

      it "should throw an Error on unexpected failure", (done) ->

        Request.receiveJSON.returns(Promise.reject(new Error("errorMessage")))

        model.fetch()
          .then(=>
            @fail("Promise should not have been resolved.")
            done()
          ).catch( (error) ->
            expect(error.message).toBe("errorMessage")
            done()
          )

