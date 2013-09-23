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

  plugins : null


  constructor : (@dimensions, @slidesBeforeProblem, @slidesAfterProblem, @assetHandler, @dataHandler) ->

    [ @width, @height, @depth ] = dimensions

    @state = new KeyValueStore()

    @plugins = new Plugins(@assetHandler)
    @createSidebar()


  setCode : (code) ->

    @code = code


  testCompile : ->

    _.isFunction(@compile())


  compile : (code) ->

    functionBody = CoffeeScript.compile(@code, bare : true)
    func = new Function(
      "plugins"
      "with(plugins) { #{functionBody} }"
    )


  getRange : ->

    console.log "range"

    return { start: 0, end: 0 } unless @dataHandler.deferred("initialized").state() == "resolved"

    func = @compile()

    inputData = @getInitialInputData()

    range = { start: Infinity, end: 0 }

    _plugins =

      time : (options) ->
        start = Math.min(options.start, range.start)
        end = Math.max(options.end, range.end)
        range = { start, end }

        (cb) -> cb()

      importSlides : ->

      unsafe : (isRangeSafe, callback) ->

        if _.isFunction(callback) and isRangeSafe
          callback(inputData)

      exit : ->
        _plugins.time = -> (->)
        range = { start: 0, end: 0 }
        return

      state : @state


    for key, plugin of @plugins
      do (plugin) ->
        if plugin.IS_RANGE_SAFE

          _plugins[key] = (options) ->
            options = {} unless options? #if plugin has no options

            _.extend( options, input : inputData )
            _.extend( options, exit : _plugins.exit )
            plugin.execute(options)

        else
          _plugins[key] = ->

    func(_plugins)

    range


  getInitialInputData : ->
    
    initialInputData = 
      state : @state
      dimensions : @dimensions
      slidesBeforeProblem : @slidesBeforeProblem
      slidesAfterProblem : @slidesAfterProblem
      mission : @dataHandler.getMissionData()



  render : (t) ->

    t = +t

    exited = false
    pixelCount = @width * @height
    frameBuffer = new Uint8Array( 4 * pixelCount )
    metaFrameData = null
    paraFrameData = null
    return { frameBuffer, metaFrameData, paraFrameData } unless @dataHandler.deferred("initialized").state() == "resolved"

    func = @compile()

    startFrame = 0
    endFrame = 0

    initialInputData = @getInitialInputData()
              
    inputData = _.clone(initialInputData)


    _plugins =


      time : (options) =>

        _.defaults(options, alpha : 1)
        startFrame = options.start
        endFrame = options.end

        if startFrame <= t <= endFrame
          (callback) =>
            _.extend(inputData,
              rgba : new Uint8Array( 4 * pixelCount )
              segmentation : new Uint16Array( pixelCount )
              relativeTime : if endFrame - startFrame > 0 then (t - startFrame) / (endFrame - startFrame) else 0
              absoluteTime : t
              writeMetaFrameData : (key, payload) ->
                metaFrameData = metaFrameData ? {}
                metaFrameData[key] = payload
              writeParaFrameData : (key, payload) ->
                paraFrameData = paraFrameData ? {}
                paraFrameData[key] = payload                
            )

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

      unsafe : (isRangeSafe, callback) -> 

        if _.isFunction(isRangeSafe)
          callback = isRangeSafe

        callback(inputData)


      exit : -> exited = true; return




    for key, plugin of @plugins
      do (plugin) ->

        _plugins[key] = (options) ->
          options = {} unless options? #if plugin has no options

          _.extend( options, input : inputData )
          _.extend( options, exit : _plugins.exit )
          plugin.execute(options)

    func(_plugins)

    if exited
      null
    else
      { frameBuffer, metaFrameData, paraFrameData }



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

