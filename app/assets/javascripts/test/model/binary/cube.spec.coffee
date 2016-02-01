mockRequire = require("mock-require")
sinon = require("sinon")
_ = require("lodash")

mockRequire("../../../oxalis/model/binary/pullqueue", {
  prototype : {
    PRIORITY_HIGHEST: 123
  }
})

Cube = require("../../../oxalis/model/binary/cube")

describe "Cube", ->

  cube = null
  pullQueue = null
  pushQueue = null

  beforeEach ->

    pullQueue = {
      add : sinon.stub()
      pull : sinon.stub()
    }

    pushQueue = {
      insert : sinon.stub()
      push : sinon.stub()
    }

    cube = new Cube([100, 100, 100], 3, 24)
    cube.setPullQueue(pullQueue)
    cube.setPushQueue(pushQueue)


  describe "Volume Annotation Handling", ->

    it "should request buckets when temporal buckets are created", (done) ->

      cube.labelVoxel([1, 1, 1], 42)

      _.defer ->
        expect(pullQueue.add.calledWith({
            bucket: [0, 0, 0, 0],
            priority: 123})
        ).toBe(true)

        expect(pullQueue.add.called).toBe(true)

        done()

