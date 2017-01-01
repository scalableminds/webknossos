import Backbone from "backbone";
import app from "app";
import Utils from "libs/utils";


class BackboneToOxalisAdapterModel extends Backbone.Model {

  initialize(oxalisModel) {

    // Default Values for inital setup / rendering
    this.oxalisModel = oxalisModel;
    this.skeletonTracingAdapter = new Backbone.Model({
      activeTreeId : 0,
      somaClicking : false,
      activeNodeId : 0,
      radius : 0,
      particleSize : 0,
      overrideNodeRadius : true,
      boundingBox : "0, 0, 0, 0, 0, 0"
    });

    this.volumeTracingAdapter = new Backbone.Model({
      activeCellId : 0
    });

    return this.listenTo(this.oxalisModel, "sync", this.bind);
  }


  bind() {

    if (this.oxalisModel.skeletonTracing) {

      // Update values after OxalisModel is done syncing
      this.skeletonTracingModel = this.oxalisModel.skeletonTracing;

      this.skeletonTracingAdapter.set("activeTreeId", this.skeletonTracingModel.getActiveTreeId());
      this.skeletonTracingAdapter.set("activeNodeId", this.skeletonTracingModel.getActiveNodeId());
      this.skeletonTracingAdapter.set("radius", this.skeletonTracingModel.getActiveNodeRadius());
      this.skeletonTracingAdapter.set("overrideNodeRadius", this.oxalisModel.user.get("overrideNodeRadius"));
      this.skeletonTracingAdapter.set("particleSize", this.oxalisModel.user.get("particleSize"));
      this.skeletonTracingAdapter.deleteActiveNode = this.skeletonTracingModel.deleteActiveNode.bind(this.skeletonTracingModel);

      const { somaClickingAllowed } = this.oxalisModel.settings;
      this.skeletonTracingAdapter.set("somaClickingAllowed", somaClickingAllowed);
      if (somaClickingAllowed) {
        this.skeletonTracingAdapter.set("somaClicking", this.oxalisModel.user.get("newNodeNewTree"));
      }


      // ####################################
      // Listen to changes in the OxalisModel

      this.listenTo(this.skeletonTracingModel, "newTree", function(id) { return this.skeletonTracingAdapter.set("activeTreeId", id, {triggeredByModel: true}); });
      this.listenTo(this.skeletonTracingModel, "newActiveTree", function(id) { return this.skeletonTracingAdapter.set("activeTreeId", id, {triggeredByModel: true}); });
      this.listenTo(this.skeletonTracingModel, "newActiveNode", function(id) {
        this.skeletonTracingAdapter.set("activeNodeId", id, {triggeredByModel: true});
        // update node radius display accordingly
        return this.skeletonTracingAdapter.set("radius", this.skeletonTracingModel.getActiveNodeRadius(), {triggeredByModel: true});
      });
      this.listenTo(this.skeletonTracingModel, "newActiveNodeRadius", function(id) { return this.skeletonTracingAdapter.set("radius", id, {triggeredByModel: true}); });


      // ######################################
      // Listen to changes in the BackboneModel

      // Some calls are deferred, so the backbone change is propagated first, as the property in question
      // may be reset again if it is invalid.
      // If the original event was triggered by the oxalis model (options.triggeredByModel), the change in the backbone model
      // doesn't need to be propagated again. This lead to race conditions, if the property was changed in the oxalis
      // model in the mean time.
      this.listenTo(this.skeletonTracingAdapter, "change:activeTreeId", function(model, id, options) {
        if (!options.triggeredByModel) {
          return _.defer( () => this.skeletonTracingModel.setActiveTree(id) );
        }
      });

      this.listenTo(this.skeletonTracingAdapter, "change:somaClicking", function(model, bool) {
        return this.oxalisModel.user.set("newNodeNewTree", bool);
      });

      this.listenTo(this.skeletonTracingAdapter, "change:activeNodeId", function(model, id, options) {
        if (!options.triggeredByModel) {
          return _.defer( () => this.skeletonTracingModel.setActiveNode(id) );
        }
      });

      this.listenTo(this.skeletonTracingAdapter, "change:particleSize", (model, size) => _.defer( () => this.oxalisModel.user.set("particleSize", size) ));

      this.listenTo(this.skeletonTracingAdapter, "change:overrideNodeRadius", function(model, bool) {
        return this.oxalisModel.user.set("overrideNodeRadius", bool);
      });

      this.listenTo(this.skeletonTracingAdapter, "change:radius", function(model, radius, options) {
        if (!options.triggeredByModel) {
          return _.defer( () => this.skeletonTracingModel.setActiveNodeRadius(radius) );
        }
      });

      return this.listenTo(this.skeletonTracingAdapter, "change:boundingBox", function(model, string) {
        const bbArray = Utils.stringToNumberArray(string);
        return this.oxalisModel.setUserBoundingBox(bbArray);
      });

    } else if (this.oxalisModel.volumeTracing) {

      // Update values after OxalisModel is done syncing
      this.volumeTracingModel = this.oxalisModel.volumeTracing;

      this.volumeTracingAdapter.set("mappedActiveCellId", this.volumeTracingModel.getMappedActiveCellId());
      this.volumeTracingAdapter.createCell = this.volumeTracingModel.createCell.bind(this.volumeTracingModel);


      // ####################################
      // Listen to changes in the OxalisModel
      this.listenTo(this.volumeTracingModel, "newActiveCell", function() {
        return this.volumeTracingAdapter.set("mappedActiveCellId", this.volumeTracingModel.getMappedActiveCellId());
      });


      // ######################################
      // Listen to changes in the BackboneModel
      return this.listenTo(this.volumeTracingAdapter, "change:mappedActiveCellId", function(model, id) {
        return this.volumeTracingModel.setActiveCell(id);
      });
    }
  }
}

export default BackboneToOxalisAdapterModel;
