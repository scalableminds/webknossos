### define ###

class EventMixin

  __instance : null

  constructor : ->
    
    return EventMixin.__instance if typeof(EventMixin.__instance) == "object"
    EventMixin.__instance = @
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

    aborted = false
    args = args.concat [stop : -> aborted = true]
    if _.isArray(@callbacks[type])
      for callback in @callbacks[type]
        callback.apply(this, args)
        return false if aborted
    true