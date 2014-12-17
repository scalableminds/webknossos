### define
backbone : Backbone
app : app
oxalis/constants : Constants
libs/utils : Utils
###


class BackboneToOxalisAdapterModel extends Backbone.Model

  initialize : (options) ->

    @oxalisModel = options.model

    # Default Values for inital setup / rendering
    @skeletonTracingAdapter = new Backbone.Model(
      activeTreeId : 0
      somaClicking : false
      activeNodeId : 0
      radius : 0
      particleSize : 0
      overrideNodeRadius : true
      boundingBox : "0, 0, 0, 0, 0, 0"
    )

    @volumeTracingAdapter = new Backbone.Model(
      activeCellId : 0
    )

    if @oxalisModel.mode != Constants.MODE_VOLUME

      # Update values after OxalisModel is done syncing
      @skeletonTracingModel = @oxalisModel.skeletonTracing

      @skeletonTracingAdapter.set("activeTreeId", @skeletonTracingModel.getActiveTreeId())
      @skeletonTracingAdapter.set("activeNodeId", @skeletonTracingModel.getActiveNodeId())
      @skeletonTracingAdapter.set("radius", @skeletonTracingModel.getActiveNodeRadius())
      @skeletonTracingAdapter.set("overrideNodeRadius", @oxalisModel.user.get("overrideNodeRadius"))
      @skeletonTracingAdapter.set("particleSize", @oxalisModel.user.get("particleSize"))
      @skeletonTracingAdapter.deleteActiveNode = @skeletonTracingModel.deleteActiveNode.bind(@skeletonTracingModel)

      if @oxalisModel.settings.somaClickingAllowed
        @skeletonTracingAdapter.set("somaClicking", @oxalisModel.user.get("newNodeNewTree"))


      # ####################################
      # Listen to changes in the OxalisModel

      @listenTo(@skeletonTracingModel, "newTree", (id) -> @skeletonTracingAdapter.set("activeTreeId", id))
      @listenTo(@skeletonTracingModel, "newActiveTree", (id) -> @skeletonTracingAdapter.set("activeTreeId", id))
      @listenTo(@skeletonTracingModel, "newActiveNode", (id) -> @skeletonTracingAdapter.set("activeNodeId", id))
      @listenTo(@skeletonTracingModel, "newActiveNodeRadius", (id) -> @skeletonTracingAdapter.set("radius", id))


      # ######################################
      # Listen to changes in the BackboneModel
      @listenTo(@skeletonTracingAdapter, "change:activeTreeId", (model, id) ->
        @skeletonTracingModel.setActiveTree(id)
      )

      @listenTo(@skeletonTracingAdapter, "change:somaClicking", (model, bool) ->
        @oxalisModel.user.set("newNodeNewTree", bool)
      )

      @listenTo(@skeletonTracingAdapter, "change:activeNodeId", (model, id) ->
        @skeletonTracingModel.setActiveNode(id)
      )

      @listenTo(@skeletonTracingAdapter, "change:particleSize", (model, size) ->
        @oxalisModel.user.set("particleSize", size)
      )

      @listenTo(@skeletonTracingAdapter, "change:overrideNodeRadius", (model, bool) ->
        @oxalisModel.user.set("overrideNodeRadius", bool)
      )

      @listenTo(@skeletonTracingAdapter, "change:radius", (model, radius) ->
        @skeletonTracingModel.setActiveNodeRadius(radius)
      )

      @listenTo(@skeletonTracingAdapter, "change:boundingBox", (model, string) ->
        bbArray = Utils.stringToNumberArray(string)
        if bbArray?.length == 6
          @oxalisModel.boundingBox = bbArray
          @oxalisModel.trigger("newBoundingBox", bbArray)
      )

    # VOLUME MODE
    else

      # Update values after OxalisModel is done syncing
      @volumeTracingModel = @oxalisModel.volumeTracing

      @volumeTracingAdapter.set("mappedActiveCellId", @volumeTracingModel.getMappedActiveCellId())
      @volumeTracingAdapter.createCell = @volumeTracingModel.createCell.bind(@volumeTracingModel)


      # ####################################
      # Listen to changes in the OxalisModel
      @listenTo(@volumeTracingModel, "newActiveCell", ->
        @volumeTracingAdapter.set("mappedActiveCellId", @volumeTracingModel.getMappedActiveCellId())
      )


      # ######################################
      # Listen to changes in the BackboneModel
      @listenTo(@volumeTracingAdapter, "change:activeCellId", (model, id) ->
        @volumeTracingModel.setActiveCell(id)
      )
