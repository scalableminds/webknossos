import Marionette from "backbone.marionette";
import SelectionItemView from "admin/views/selection_item_view";

class SelectionView extends Marionette.CollectionView {
  static initClass() {
    this.prototype.tagName = "select";
    this.prototype.className = "form-control";

    this.prototype.childView = SelectionItemView;
  }
  attributes() {
    return {
      name: this.options.name,
      required: this.options.required,
      disabled: this.options.disabled,
    };
  }

  initialize(options) {
    // append an empty option if the emptyOption option was supplied
    if (options.emptyOption) {
      this.listenTo(this, "render", this.afterRender);
    }

    return this.collection.fetch({
      data: options.data,
    });
  }

  filter(...args) {
    if (this.options.filter) {
      return this.options.filter(...args);
    }
    return true;
  }

  afterRender() {
    return this.$el.prepend("<option></option>");
  }
}
SelectionView.initClass();

export default SelectionView;
