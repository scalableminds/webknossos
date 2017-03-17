/**
 * mapping_info_view.js
 * @flow weak
 */

import Backbone from "backbone";
import Marionette from "backbone.marionette";
import Subviews from "backbone-subviews";
import _ from "lodash";
import CheckboxSettingView from "oxalis/view/settings/setting_views/checkbox_setting_view";
import Binary from "oxalis/model/binary";
import Cube from "oxalis/model/binary/data_cube";
import Store from "oxalis/store";
import { getPosition } from "oxalis/model/accessors/flycam3d_accessor";

const RENDER_DEBOUNCE_TIME = 200;

class MappingInfoView extends Marionette.View {

  subviewCreators: Object;
  model: Backbone.Model;
  binary: Binary;
  cube: Cube;
  renderDebounced: Function;

  static initClass() {
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

      enableMapping() {
        return new CheckboxSettingView({
          model: this.model,
          options: {
            name: "enableMapping",
            displayName: "Enable Mapping",
          },
        });
      },
    };
  }


  initialize({ model: oxalisModel }) {
    Subviews.add(this);

    this.model = new Backbone.Model();
    this.model.set("enableMapping", true);

    this.binary = oxalisModel.getSegmentationBinary();
    this.cube = this.binary.cube;

    this.renderDebounced = _.debounce(this.render, RENDER_DEBOUNCE_TIME);
    this.listenTo(this.cube, "bucketLoaded", this.renderDebounced);
    this.listenTo(this.cube, "volumeLabeled", this.renderDebounced);
    this.listenTo(this.cube, "newMapping", this.render);
    this.listenTo(this.model, "change:enableMapping", function () {
      return this.cube.setMappingEnabled(this.model.get("enableMapping"));
    });
    Store.subscribe(() => { this.renderDebounced(); });
  }


  serializeData() {
    const pos = getPosition(Store.getState().flycam);

    return {
      hasMapping: this.cube.hasMapping(),
      idWithMapping: this.cube.getDataValue(pos, this.cube.mapping),
      idWithoutMapping: this.cube.getDataValue(pos, null),
    };
  }
}
MappingInfoView.initClass();

export default MappingInfoView;
