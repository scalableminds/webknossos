import _ from "lodash";
import AbstractSettingView from "./abstract_setting_view";

class NumberSettingView extends AbstractSettingView {
  static initClass() {
    this.prototype.className = "number-setting-view row";


    this.prototype.template = _.template(`\
<div class="col-sm-5">
  <%- displayName %>
</div>
<div class="col-sm-7">
  <input class="form-control" type="number" min="<%- min %>" max="<%- max %>" step="<%- step %>" value="<%- value %>">
</div>\
`);


    this.prototype.ui =
      { number: "input[type=number]" };


    this.prototype.events =
      { "change @ui.number": "handleChange" };
  }


  initialize(options) {
    super.initialize(options);

    return _.defaults(this.options, {
      min: "",
      max: "",
      step: 1,
    },
    );
  }


  handleChange(evt) {
    this.model.set(this.options.name, (Number)(evt.target.value));
  }


  update(model, value) {
    return this.ui.number.val(value);
  }
}
NumberSettingView.initClass();

export default NumberSettingView;
