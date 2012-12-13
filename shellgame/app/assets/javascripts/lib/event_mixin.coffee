### define 
underscore : _
jquery : $
###

class EventMixin

  constructor : ->

    @__callbacks = {}
    @__deferreds = {}


  on : (type, callback) ->

    unless _.isObject(type)

      unless _.isArray(@__callbacks[type])
        @__callbacks[type] = [ callback ]
      else
        @__callbacks[type].push(callback)

    else

      map = type
      for own type, callback of map
        @on(type, callback)

    this


  one : (type, callback) ->

    wrappedCallback = (args...) =>

      callback(args...)
      @off(type, wrappedCallback)


    unless _.isObject(type)

     @on(type, wrappedCallback)

    else

      map = type
      for own type, callback of map
        @on(type, wrappedCallback)

    this


  off : (type, callback) ->

    if _.isArray(@__callbacks[type])
      _.removeElement(@__callbacks[type], callback)
    this


  trigger : (type, args...) ->

    if deferred = @__deferreds[type]
      deferred.resolve(args...)

    if _.isArray(@__callbacks[type])
      for callback in @__callbacks[type]
        callback.apply(this, args)

    this


  ask : (type, args...) ->

    if _.isArray(@__callbacks[type])
      for callback in @__callbacks[type]
        answer = callback.apply(this, args)
        return answer unless answer == undefined
    return


  passthrough : (obj, type, renamedType = type) ->

    if _.isArray(type)

      types = type
      for type in types
        @passthrough(obj, type, type) 

    else if _.isObject(type)

      typeMap = type
      for type, renamedType of typeMap
        @passthrough(obj, type, renamedType) 

    else

      obj.on type, (args...) => 
        @trigger(renamedType, args...)
      
    this


  addDeferred : (type) ->

    @__deferreds[type] = new $.Deferred()


  deferred : (type) ->

    @__deferreds[type]


  @extend : (obj) ->

    _.extend(obj, new this())
