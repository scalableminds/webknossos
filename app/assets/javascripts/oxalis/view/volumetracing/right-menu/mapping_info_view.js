import Backbone from "backbone";
import Marionette from "backbone.marionette";
import subviews from "backbone-subviews";
import _ from "lodash";
import CheckboxSettingView from "oxalis/view/settings/setting_views/checkbox_setting_view";

class MappingInfoView extends Marionette.View {
  static initClass() {
    this.prototype.RENDER_DEBOUNCE_TIME = 200;

    this.prototype.id = "volume-mapping-info";
    this.prototype.template = _.template(`\
<div class="well">
  <% if (hasMapping) { %>
    <p>ID without mapping: <%- idWithoutMapping %></p>
    <p>ID with mapping: <%- idWithMapping %></p>
  <% } else { %>
    <p>ID at current position: <%- idWithoutMapping %></p>
  <% } %>
</div>
<% if (hasMapping) { %>
  <div data-subview="enableMapping"></div>
<% } %>\
`);


    this.prototype.subviewCreators = {

      enableMapping: () => new CheckboxSettingView({
        model: this.model,
        options: {
          name: "enableMapping",
          displayName: "Enable Mapping",
        },
      }),
    };
  }


  initialize({ model: oxalisModel }) {
    Backbone.Subviews.add(this);

    this.model = new Backbone.Model();
    this.model.set("enableMapping", true);

    this.binary = oxalisModel.getSegmentationBinary();
    this.cube = this.binary.cube;
    this.flycam = oxalisModel.flycam;

    this.renderDebounced = _.debounce(this.render, this.RENDER_DEBOUNCE_TIME);
    this.listenTo(this.cube, "bucketLoaded", this.renderDebounced);
    this.listenTo(this.cube, "volumeLabeled", this.renderDebounced);
    this.listenTo(this.cube, "newMapping", this.render);
    this.listenTo(this.flycam, "positionChanged", this.renderDebounced);
    return this.listenTo(this.model, "change:enableMapping", function () {
      return this.cube.setMappingEnabled(this.model.get("enableMapping"));
    });
  }


  serializeData() {
    const pos = this.flycam.getPosition();

    return {
      hasMapping: this.cube.hasMapping(),
      idWithMapping: this.cube.getDataValue(pos, this.cube.mapping),
      idWithoutMapping: this.cube.getDataValue(pos, this.cube.EMPTY_MAPPING),
    };
  }
}
MappingInfoView.initClass();

export default MappingInfoView;
