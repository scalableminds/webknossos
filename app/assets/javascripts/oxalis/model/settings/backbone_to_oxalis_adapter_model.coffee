Backbone = require("backbone")
app      = require("app")
Utils    = require("libs/utils")


class BackboneToOxalisAdapterModel extends Backbone.Model

  initialize : (@oxalisModel) ->

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

    @listenTo(@oxalisModel, "sync", @bind)


  bind : ->

    if @oxalisModel.skeletonTracing

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

      @listenTo(@skeletonTracingModel, "newTree", (id) -> @skeletonTracingAdapter.set("activeTreeId", id, {triggeredByModel: true}))
      @listenTo(@skeletonTracingModel, "newActiveTree", (id) -> @skeletonTracingAdapter.set("activeTreeId", id, {triggeredByModel: true}))
      @listenTo(@skeletonTracingModel, "newActiveNode", (id) ->
        @skeletonTracingAdapter.set("activeNodeId", id, {triggeredByModel: true})
        # update node radius display accordingly
        @skeletonTracingAdapter.set("radius", @skeletonTracingModel.getActiveNodeRadius(), {triggeredByModel: true})
      )
      @listenTo(@skeletonTracingModel, "newActiveNodeRadius", (id) -> @skeletonTracingAdapter.set("radius", id, {triggeredByModel: true}))


      # ######################################
      # Listen to changes in the BackboneModel

      # Some calls are deferred, so the backbone change is propagated first, as the property in question
      # may be reset again if it is invalid.
      # If the original event was triggered by the oxalis model (options.triggeredByModel), the change in the backbone model
      # doesn't need to be propagated again. This lead to race conditions, if the property was changed in the oxalis
      # model in the mean time.
      @listenTo(@skeletonTracingAdapter, "change:activeTreeId", (model, id, options) ->
        if not options.triggeredByModel
          _.defer( => @skeletonTracingModel.setActiveTree(id) )
      )

      @listenTo(@skeletonTracingAdapter, "change:somaClicking", (model, bool) ->
        @oxalisModel.user.set("newNodeNewTree", bool)
      )

      @listenTo(@skeletonTracingAdapter, "change:activeNodeId", (model, id, options) ->
        if not options.triggeredByModel
          _.defer( => @skeletonTracingModel.setActiveNode(id) )
      )

      @listenTo(@skeletonTracingAdapter, "change:particleSize", (model, size) ->
        _.defer( => @oxalisModel.user.set("particleSize", size) )
      )

      @listenTo(@skeletonTracingAdapter, "change:overrideNodeRadius", (model, bool) ->
        @oxalisModel.user.set("overrideNodeRadius", bool)
      )

      @listenTo(@skeletonTracingAdapter, "change:radius", (model, radius, options) ->
        if not options.triggeredByModel
          _.defer( => @skeletonTracingModel.setActiveNodeRadius(radius) )
      )

      @listenTo(@skeletonTracingAdapter, "change:boundingBox", (model, string) ->
        bbArray = Utils.stringToNumberArray(string)
        @oxalisModel.setUserBoundingBox(bbArray)
      )

    else if @oxalisModel.volumeTracing

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
      @listenTo(@volumeTracingAdapter, "change:mappedActiveCellId", (model, id) ->
        @volumeTracingModel.setActiveCell(id)
      )

module.exports = BackboneToOxalisAdapterModel
