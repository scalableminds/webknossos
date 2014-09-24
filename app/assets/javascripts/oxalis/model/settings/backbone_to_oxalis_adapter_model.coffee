### define
backbone : Backbone
app : app
###


class BackboneToOxalisAdapterModel extends Backbone.Model

  initialize : (options) ->

    @oxalisModel = options._model

    # Default Values for inital setup / rendering
    @skeletonTracingAdapter = new Backbone.Model(
      activeTreeId : 0
      somaClicking : false
      activeNodeId : 0
      radius : 0
      particleSize : 0
      overrideNodeRadius : true
    )
    @volumneTracingAdapter = {}


    # Wait for OxalisModel to finish syncing
    @listenTo(app.vent, "model:sync", ->

      # Update values after OxalisModel is done syncing
      @skeletonTracingModel = @oxalisModel.skeletonTracing

      @skeletonTracingAdapter.set("activeTreeId", @skeletonTracingModel.getActiveTreeId())
      @skeletonTracingAdapter.set("activeNodeId", @skeletonTracingModel.getActiveNodeId())
      @skeletonTracingAdapter.set("radius", @skeletonTracingModel.getActiveNodeRadius())
      @skeletonTracingAdapter.set("overrideNodeRadius", @oxalisModel.user.get("overrideNodeRadius"))
      @skeletonTracingAdapter.set("particleSize", @oxalisModel.user.get("particleSize"))

      if @oxalisModel.settings.somaClicking
        @skeletonTracingAdapter.set("somaClicking", @oxalisModel.user.get("newNodeNewTree"))


      # ####################################
      # Listen to changes in the OxalisModel

      @listenTo(@skeletonTracingModel, "newTree", (id) -> @skeletonTracingAdapter.set("activeTreeId", id))
      @listenTo(@skeletonTracingModel, "newActiveTree", (id) -> @skeletonTracingAdapter.set("activeTreeId", id))
      @listenTo(@skeletonTracingModel, "newActiveNodeRadius", (id) -> @skeletonTracingAdapter.set("radius", id))



      # ######################################
      # Listen to changes in the BackboneModel
      @listenTo(@skeletonTracingAdapter, "change:activeTreeId", (model, id) ->
        @skeletonTracingModel.setActiveTree(id)
      )

      @listenTo(@skeletonTracingAdapter, "change:somaClicking", (model, bool) ->
        @oxalisModel.user.set("newNodeNewTree")
      )
    )
