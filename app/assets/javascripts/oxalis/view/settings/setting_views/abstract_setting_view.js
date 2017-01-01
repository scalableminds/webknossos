import _ from "lodash";
import Marionette from "backbone.marionette";

class AbstractSettingView extends Marionette.View {


  initialize({ model, options }) {

    this.model = model;
    this.options = options;
    this.listenTo(this.model, `change:${this.options.name}` , this.update);
    return this.options = _.defaults(this.options, {enabled: true});
  }


  serializeData() {

    return _.extend(
      this.options,
      { value : this.model.get(this.options.name) }
    );
  }
}

export default AbstractSettingView;
