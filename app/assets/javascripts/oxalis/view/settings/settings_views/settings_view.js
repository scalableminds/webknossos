import _ from "lodash";
import Utils from "libs/utils";
import Marionette from "backbone.marionette";
import Subviews from "backbone-subviews";

class SettingsView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<div class="panel-group flex-overflow">
  
  <% _.forEach(subviewCreatorsList, function (key_value_pair) { %>
    <div data-subview="<%- key_value_pair[0] %>"></div>
  <% }) %>
  
</div>\
`);


    this.prototype.modelName = null;
  }


  initialize() {
    if (this.modelName != null) {
      this.model = this.model[this.modelName];
    }

    if (this.subviewCreatorsList == null) {
      throw new Error(
        "Subclasses of CategoryView must specify subviewCreatorsList");
    }

    // subviewCreators hash needed for Subviews extension
    this.subviewCreators = _.transform(
      this.subviewCreatorsList,
      (result, [key, value]) => result[key] = value,
      {},
    );

    return Subviews.add(this);
  }


  render() {
    if (this.model) {
      return super.render();
    } else {
      return this.$el.html(Utils.loaderTemplate());
    }
  }


  serializeData() {
    return { subviewCreatorsList: this.subviewCreatorsList };
  }
}
SettingsView.initClass();

export default SettingsView;
