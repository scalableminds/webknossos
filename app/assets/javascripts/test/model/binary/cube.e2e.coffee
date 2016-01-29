mockRequire = require("mock-require")

mockRequire("../../../oxalis/model/binary/pullqueue", {
  prototype : {
    PRIORITY_HIGHEST: -1
  }
})

Cube = require("../../../oxalis/model/binary/cube")

describe "Cube", ->

  cube = null
  beforeEach ->
    cube = new Cube([100, 100, 100], 3, 24)


  describe "Foo", ->

    it "test", ->

      expect(3).toBe(3)
