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


  constructor : (@dimensions, @assetHandler, @dataHandler) ->

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

    exited = false
    pixelCount = @width * @height
    frameBuffer = new Uint8Array( 4 * pixelCount )
    frameData = null
    return { frameBuffer, frameData } unless @dataHandler.deferred("initialized").state() == "resolved"

    func = @compile()

    startFrame = 0
    endFrame = 0

    inputData = null

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
              relativeTime : (t - startFrame) / (endFrame - startFrame)
              absoluteTime : t
              state : @state
              dimensions : @dimensions
              mission : @dataHandler.getMissionData()
              writeFrameData : (key, payload) ->
                frameData = frameData ? {}
                frameData[key] = payload

            callback()
            BufferUtils.alphaBlendBuffer(frameBuffer, inputData.rgba, options.alpha)
            
            inputData = null

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


