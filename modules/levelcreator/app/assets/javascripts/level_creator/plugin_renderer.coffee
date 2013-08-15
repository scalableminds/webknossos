### define
underscore : _
coffee-script : CoffeeScript
routes : Routes
libs/event_mixin : EventMixin
libs/key_value_store : KeyValueStore
./plugins : Plugins
./buffer_utils : BufferUtils
###

class PluginRenderer

  PIXEL_SIZE : 11.3

  plugins : null


  constructor : (@dimensions, @slidesBeforeProblem, @slidesAfterProblem, @assetHandler, @dataHandler) ->

    [ @width, @height, @depth ] = dimensions

    @state = new KeyValueStore()

    @plugins = new Plugins(@assetHandler)
    @createSidebar()


  setCode : (code) ->

    return unless code?
    return unless @dataHandler.deferred("initialized").state() == "resolved"

    keyValues = @getMacroValues code
    @code = @replaceMacros code, keyValues


  testCompile : ->

    _.isFunction(@compile())


  compile : (code) ->

    functionBody = CoffeeScript.compile(@code, bare : true)
    func = new Function(
      "plugins"
      "with(plugins) { #{functionBody} }"
    )


  getLength : ->

    func = @compile()

    length = 0

    _plugins =

      time : (options) ->

        length = Math.max(options.end + 1, length)
        (cb) -> cb()

      importSlides : ->

      unsafe : ->

      exit : ->
        _plugins.time = -> (->)
        length = 0
        return

      state : @state

    (_plugins[key] = ->) for key of @plugins

    func(_plugins)

    length


  render : (t) ->

    t = +t

    exited = false
    pixelCount = @width * @height
    frameBuffer = new Uint8Array( 4 * pixelCount )
    frameData = null
    return { frameBuffer, frameData } unless @dataHandler.deferred("initialized").state() == "resolved"

    func = @compile()

    startFrame = 0
    endFrame = 0

    initialInputData = 
      state : @state
      dimensions : @dimensions
      mission : @dataHandler.getMissionData()
              
    inputData = _.clone(initialInputData)


    _plugins =


      time : (options) =>

        _.defaults(options, alpha : 1)
        startFrame = options.start
        endFrame = options.end

        if startFrame <= t <= endFrame
          (callback) =>
            inputData = 
              rgba : new Uint8Array( 4 * pixelCount )
              segmentation : new Uint16Array( pixelCount )
              relativeTime : if endFrame - startFrame > 0 then (t - startFrame) / (endFrame - startFrame) else 0
              absoluteTime : t
              writeFrameData : (key, payload) ->
                frameData = frameData ? {}
                frameData[key] = payload

            callback()
            BufferUtils.alphaBlendBuffer(frameBuffer, inputData.rgba, options.alpha)
            
            inputData = _.clone(initialInputData)

        else
          ->

      importSlides : (options) =>

        _.defaults(options, scale : "auto")


        if options.scale == "auto"
          if endFrame - startFrame > 0
            options.scale = (options.end - options.start) / (endFrame - startFrame)
          else
            options.scale = 1

        slideOffset = (t - startFrame) * options.scale + options.start
        _.extend(inputData,
          rgba : @dataHandler.getRGBASlide( slideOffset )
          segmentation : @dataHandler.getSegmentationSlide( slideOffset )
        )

        @plugins.segmentImporter.execute(input : inputData, slideOffset)


      state : @state

      unsafe : (callback) -> callback(inputData)

      exit : -> exited = true; return



    for key, plugin of @plugins
      do (plugin) ->

        _plugins[key] = (options) ->
          options = {} unless options? #if plugin has no options

          _.extend( options, input : inputData )
          plugin.execute(options)

    func(_plugins)

    if exited
      null
    else
      { frameBuffer, frameData }



  pluginDocTemplate : _.template """
    <div class="accordion-group">
      <div class="accordion-heading">
        <a class="accordion-toggle"
          data-toggle="collapse"
          data-parent="<%= containerName %>"
          href="#<%= bodyId %>">
          <%= plugin.FRIENDLY_NAME %>
        </a>
      </div>
      <div id="<%= bodyId %>" class="accordion-body collapse">
        <div class="accordion-inner">
          <dl>
            <dt><%= plugin.COMMAND %></dt>
            <dd><%= plugin.DESCRIPTION %></dd>
          </dl>
          <h5>Parameter:</h5>
          <dl class="dl-horizontal">
            <% Object.keys(plugin.PARAMETER).forEach(function (parameterName) { %>
              <% if (parameterName == "input") return; %>
                <dt><%= parameterName %></dt>
                <dd><%= plugin.PARAMETER[parameterName] %></dd>
            <% }) %>
          </dl>
          <% if (plugin.EXAMPLES) { %>
            <h5>Examples:</h5>
            <% plugin.EXAMPLES.forEach(function (example) { %>
              <span><%= example.description %></span>
              <pre class="prettyprint linenums"><ol class="linenums"><% example.lines.forEach(function (line) { %><li><span class="pln"><%= line %></span></li><% }) %></ol></pre>
            <% }) %>
          <% } %>
        </div>
      </div>
    </div>
  """

  createSidebar : ->

    { plugins } = @

    containerName = "#plugins"

    for pluginName, i in Object.keys(plugins)

      plugin = plugins[pluginName]

      continue if plugin.PUBLIC is false

      $(containerName).append(
        @pluginDocTemplate { i, plugin, containerName, bodyId : "collapseBody#{i}" }
      )


  replaceMacros : (object, keyValues) ->

    json = JSON.stringify(object)

    for key of keyValues

      re = new RegExp("\\$#{key}", "g")
      json = json.replace(re, "#{keyValues[key]}")

    jQuery.parseJSON( json )


  getMacroValues : (code) ->


    missionData = @dataHandler.getMissionData()

    # get meta info from code
    # DESIRED_SLIDES_BEFORE_PROBLEM
    # DESIRED_SLIDES_AFTER_PROBLEM
    # SEGMENTS_AT_START
    # SEGMENTS_AT_END


    result = code.match( /DESIRED_SLIDES_BEFORE_PROBLEM\=([0-9]+)/m )
    if result?.length is 2
      desiredStartSlide = @slidesBeforeProblem - parseInt(result[1])
    else
      desiredStartSlide = 0

    result = code.match( /MIN_END_SEGMENTS_AT_FIRST_SLIDE\=([0-9]+)/m )
    if result?.length is 2
      minEndSegmentsAtFirstSlide = parseInt(result[1])
    else
      minEndSegmentsAtFirstSlide = 0

    result = code.match( /DESIRED_SLIDES_AFTER_PROBLEM\=([0-9]+)/m )
    if result?.length is 2
      desiredEndSlide = @slidesBeforeProblem + parseInt(result[1])
    else
      desiredEndSlide = @slidesBeforeProblem + @slidesAfterProblem

    result = code.match( /MIN_END_SEGMENTS_AT_LAST_SLIDE\=([0-9]+)/m )
    if result?.length is 2
      minEndSegmentsAtLastSlide = parseInt(result[1]) - 1 # -1 for startSegment
    else
      minEndSegmentsAtLastSlide = 0

    result = code.match( /NO_START_SEGMENT_AT_LAST_SLIDE\=([a-z]+)/m )
    if result?.length is 2
      if result[1] is "true"
        noStartSegmentAtLastSlide = true
      else
        noStartSegmentAtLastSlide = false
    else
      noStartSegmentAtLastSlide = false      

    # check plausibility

    if missionData.possibleEnds.length < minEndSegmentsAtFirstSlide
      console.log "abort"


    # apply filters

    # get StartSlide - apply DESIRED_SLIDES_BEFORE_PROBLEM and MIN_SEGMENTS_AT_FIRST_SLIDE

    firstStartFrame = @nmToSlide(missionData.start.firstFrame)

    searchStart = Math.max(firstStartFrame, desiredStartSlide)


    for i in [Math.floor(searchStart)...@slidesBeforeProblem] by 1
      result = _.filter(missionData.possibleEnds, (e) => 
        #console.log @nmToSlide(e.firstFrame) + "  - " + i + " -  " + @nmToSlide(e.lastFrame)
        @nmToSlide(e.firstFrame) < i < @nmToSlide(e.lastFrame) ).length
      #console.log i + " " + result
      if result >= minEndSegmentsAtFirstSlide 
        startSlide = i
        break

    
    console.log "abort" unless startSlide?
    console.log "Start: " + startSlide

    startSlide = 0 unless startSlide?


    # get endSlide
    lastStartFrame = @nmToSlide(missionData.start.lastFrame)

    if noStartSegmentAtLastSlide
      searchEnd = Math.max(@slidesBeforeProblem, lastStartFrame)
    else
      searchEnd = @slidesBeforeProblem

    for i in [Math.floor(desiredEndSlide)...searchEnd] by -1
      result = _.filter(missionData.possibleEnds, (e) => 
        #console.log @nmToSlide(e.firstFrame) + "  - " + i + " -  " + @nmToSlide(e.lastFrame)
        @nmToSlide(e.firstFrame) < i < @nmToSlide(e.lastFrame) ).length
      #console.log i + " " + result
      if result >= minEndSegmentsAtLastSlide 
        endSlide = i
        break

    
    console.log "abort" unless endSlide?
    console.log "end: " + endSlide

    endSlide = @slidesBeforeProblem + @slidesAfterProblem unless endSlide?



    # return macro values
    keyValues = new Object()

    keyValues.START = startSlide
    keyValues.END = endSlide
    keyValues.LENGTH = endSlide - startSlide
    keyValues.ERROR_CENTER = @slidesBeforeProblem
    keyValues.DATA_START = 0
    keyValues.DATA_END = @slidesAfterProblem+@slidesBeforeProblem
    keyValues.DATA_ELENGTH = @slidesAfterProblem+@slidesBeforeProblem

    console.log keyValues
    keyValues



  nmToSlide : (nm) ->
    
    (nm / @PIXEL_SIZE) + @slidesBeforeProblem    
