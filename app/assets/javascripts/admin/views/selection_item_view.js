import _ from "lodash";
import Marionette from "backbone.marionette";

class SelectionItemView extends Marionette.View {
  static initClass() {
    this.prototype.tagName = "option";

    this.prototype.template = _.template("\
<%- label %>\
");
  }
  attributes() {
    const defaults = {
      id: this.model.get("id"),
      value: this.options.modelValue(),
    };

    if (this.options.defaultItem) {
      const [[key, value]] = _.toPairs(this.options.defaultItem);
      if (this.model.get(key) === value) {
        _.extend(defaults, { selected: true });
      }
    }

    return defaults;
  }

  initialize(options) {
    // a function to retrieve the option's value
    this.modelValue = options.modelValue;

    // a function to retrieve the option's label (displayed text)
    this.modelLabel = options.modelLabel;

    this.listenTo(this, "render", this.afterRender);
  }


  serializeData() {
    const label = this.modelLabel ? this.modelLabel() : this.modelValue();

    return {
      value: this.modelValue(),
      label,
      id: this.model.get("id"),
    };
  }
}
SelectionItemView.initClass();


export default SelectionItemView;
