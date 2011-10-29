EventEmitter = (->
  callbacks = {}
  emitted = {}

  # emit an event
  emit: (evnt, args...) ->
    chain = callbacks[evnt]
    if chain?
      for chain_item in chain
        chain_item(args...)
      callbacks[evnt] = chain.filter((a) -> !a.once)
    
    emitted[evnt] = args

  # hook up an event listener
  on: (evnt, callback) ->
    callbacks[evnt] ?= []
    callbacks[evnt].push { callback: callback }
    @
  
  # hook up an event listener, which will only be called once and then removed
  once: (evnt, callback) ->
    callbacks[evnt] ?= []
    callbacks[evnt].push { callback: callback, once: true }
    @
  
  # either the event has already been emitted, then the callback is called 
  # after clearing the current stack (deferred, but kinda immediately)
  # or the callback is hooked up as an once-listener
  wait: (evnt, callback) ->
    if emitted[evnt]?
      setTimeout((-> callback(emitted[evnt]...)), 1)
    else
      @once(evnt, callback)
    @
)