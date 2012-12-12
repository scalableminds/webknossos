define [
  "underscore"
], (_) ->
  class EventMixin

    constructor : ->

      @callbacks = {}


    on : (type, callback) ->

      unless _.isObject(type)

        unless _.isArray(@callbacks[type])
          @callbacks[type] = [ callback ]
        else
          @callbacks[type].push(callback)

      else

        map = type
        for own type, callback of map
          @on(type, callback)

      this


    off : (type, callback) ->

      if _.isArray(@callbacks[type])
        _.removeElement(@callbacks[type], callback)
      this


    trigger : (type, args...) ->

      if _.isArray(@callbacks[type])
        for callback in @callbacks[type]
          callback.apply(this, args)
      this


    ask : (type, args...) ->

      if _.isArray(@callbacks[type])
        for callback in @callbacks[type]
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


    @extend : (obj) ->

      _.extend(obj, new this())