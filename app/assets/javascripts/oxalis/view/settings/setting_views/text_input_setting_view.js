import _ from "lodash";
import AbstractSettingView from "./abstract_setting_view";

class TextInputSettingView extends AbstractSettingView {
  static initClass() {
    this.prototype.className = "text-setting-view row";


    this.prototype.template = _.template(`\
<div class="col-sm-5">
  <%- displayName %>
</div>
<div class="col-sm-7">
  <input class="form-control" type="text" pattern="<%- pattern %>" title="<%- title %>" value="<%- value %>">
</div>\
`);


    this.prototype.ui =
      { text: "input[type=text]" };


    this.prototype.events =
      { "change @ui.text": "handleChange" };
  }


  initialize(options) {
    super.initialize(options);

    _.defaults(this.options, {
      pattern: "",
      title: "",
    },
    );
  }

  handleChange(evt) {
    const { value } = evt.target;

    if (this.options.validate) {
      if (!this.options.validate.call(this, value)) { return; }
    }

    this.model.set(this.options.name, value);
  }


  update(model, value) {
    this.ui.text.val(value);
  }
}
TextInputSettingView.initClass();

export default TextInputSettingView;
