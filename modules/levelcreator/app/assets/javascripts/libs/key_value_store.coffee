### define 
underscore : _
###

class KeyValueStore
  
  constructor : ->

    @attributes = {}


  getOrSet : (key, value) ->
        
    if @attributes[key]?
      @attributes[key]
    else
      if _.isFunction(value) 
        @attributes[key] = value()
      else
        @attributes[key] = value


  set : (key, value) ->

    @attributes[key] = value
    return


  get : (key) -> 

    @attributes[key]


  clear : ->

    @attributes = {}

