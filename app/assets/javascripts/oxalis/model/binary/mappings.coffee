### define
underscore : _
jquery : $
libs/request : Request
###

class Mappings


  constructor : (datasetName, layer) ->

    @mappings = _.indexBy(layer.mappings, "name")
    @baseUrl = "/data/datasets/#{datasetName}/layers/#{layer.name}/mappings/"
    @getParams = "?token=#{layer.token}"


  getMappingNames : ->

    return _.keys(@mappings)


  getMappingArrayAsync : (mappingName) ->

    @fetchMappings(mappingName).then( =>
      @getMappingArray(mappingName)
    )


  fetchMappings : (mappingName) ->

    mappingChain = @getMappingChain(mappingName)
    promises = _.map(mappingChain, (mappingName) => @fetchMapping(mappingName))
    return $.when(promises...)


  fetchMapping : (mappingName) ->

    if @mappings[mappingName].mappingObject?
      return $.Deferred().resolve().promise()

    Request.json(
      @baseUrl + mappingName + @getParams
    ).$().then(
      (mapping) =>
        @mappings[mappingName].mappingObject = mapping
        console.log("Done downloading:", mappingName)
      (error) ->
        console.error("Error downloading:", mappingName, error)
    )


  getMappingArray : (mappingName) ->

    mapping = @mappings[mappingName]
    if mapping.mappingArray?
      return mapping.mappingArray

    return mapping.mappingArray = @buildMappingArray(mappingName)


  buildMappingArray : (mappingName) ->

    mappingArray = []

    for currentMappingName in @getMappingChain(mappingName)

      mappingObject = @mappings[currentMappingName].mappingObject
      $.assert(mappingObject,
          "mappingObject must have been fetched at this point")

      for mappingClass in mappingObject.classes

        minId = @min(mappingClass)
        mappedId = mappingArray[minId] || minId

        for id in mappingClass
          mappingArray[id] = mappedId

    return mappingArray


  getMappingChain : (mappingName) ->

    chain = [mappingName]
    mapping = @mappings[mappingName]

    while mapping.parent?
      chain.push(mapping.parent)
      mapping = @mappings[mapping.parent]

    return chain


  # Since Math.min(array...) does not scale
  min : (array) ->

    min = Infinity
    for entry in array
      min = Math.min(min, entry)
    return min
