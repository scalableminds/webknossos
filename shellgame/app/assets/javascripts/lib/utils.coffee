### define 
jquery : $
###
  
Utils = 

  distance : (a, b) ->

    Math.sqrt(a * a + b * b)
    

  distanceSquared : (a, b) ->

    a * a + b * b


  clamp : (a, x, b) ->

    Math.max(a, Math.min(b, x))


  whenWithProgress : (promises...) ->

    deferred = new $.Deferred()

    promises = _.flatten(promises)

    length = promises.length
    loaded = 0

    result = new Array(promises.length)

    for promise, i in promises

      do (promise, i) ->

        promise.then(
          (data) ->
            result[i] = data
            deferred.notify(++loaded / length, data)
            deferred.resolve(result) if loaded == length
            return

          (error) ->
            deferred.reject(error)
            return
        )

    deferred.promise()