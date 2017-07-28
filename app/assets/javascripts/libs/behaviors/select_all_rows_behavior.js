import Marionette from "backbone.marionette";

class SelectAllRowsBehavior extends Marionette.Behavior {
  static initClass() {
    this.prototype.events = { "change input.select-all-rows": "selectAllRows" };
  }

  selectAllRows(evt) {
    this.$el.find("tbody input.select-row").prop("checked", evt.target.checked);
  }
}
SelectAllRowsBehavior.initClass();

export default SelectAllRowsBehavior;
