runAsync = require("../helpers/run-async")

Deferred = require("../../libs/deferred")

describe "Deferred", ->


  makeGetState = (promise) ->

    resolved = rejected = false
    result = null

    promise.then(
      (res) ->
        resolved = true
        result = res
      (res) ->
        rejected = true
        result = res
    )
    return -> {resolved, rejected, result}


  it "should initialize an unresolved Promise", (done) ->

    deferred = new Deferred()
    getState = makeGetState(deferred.promise())

    runAsync([
      ->
        {resolved, rejected} = getState()
        expect(resolved).toBe(false)
        expect(rejected).toBe(false)
        done()
    ])


  it "should resolve the Promise", (done) ->

    deferred = new Deferred()
    getState = makeGetState(deferred.promise())

    deferred.resolve(123)

    runAsync([
      ->
        {resolved, rejected, result} = getState()
        expect(resolved).toBe(true)
        expect(rejected).toBe(false)
        expect(result).toBe(123)
        done()
    ])


  it "should reject the Promise", (done) ->

    deferred = new Deferred()
    getState = makeGetState(deferred.promise())

    deferred.reject(123)

    runAsync([
      ->
        {resolved, rejected, result} = getState()
        expect(resolved).toBe(false)
        expect(rejected).toBe(true)
        expect(result).toBe(123)
        done()
    ])
