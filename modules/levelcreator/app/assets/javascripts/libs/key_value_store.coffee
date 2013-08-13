### define ###

class KeyValueStore
	
	constructor : ->

		@attributes = {}


	getOrSet : (key, value) ->
        
    if @attributes[key]?
      @attributes[key]
    else
      @attributes[key] = value


  set : (key, value) ->

    @attributes[key] = value
    return


  get : (key) -> 

  	@attributes[key]


  clear : ->

  	@attributes = {}

