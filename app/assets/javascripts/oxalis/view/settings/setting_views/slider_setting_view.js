import _ from "lodash";
import AbstractSettingView from "./abstract_setting_view";

class SliderSettingView extends AbstractSettingView {
  static initClass() {
    this.prototype.className = "slider-setting-view row";


    this.prototype.template = _.template(`\
<div class="col-sm-5">
  <%- displayName %>
</div>
<div class="col-sm-3 no-gutter v-center">
  <div class="v-center-agent">
    <input type="range" min="<%- min %>" max="<%- max %>" step="<%- step %>" value="<%- typeof logScaleBase != "undefined" ? Math.log(value) / Math.log(logScaleBase) : value %>">
  </div>
</div>
<div class="col-sm-4">
  <input class="form-control" type="number" min="<%- min %>" max="<%- max %>" step="<%- step %>" value="<%- value %>">
</div>\
`);


    this.prototype.ui = {
      slider: "input[type=range]",
      text: "input[type=number]",
    };


    this.prototype.events = {
      "input @ui.slider": "handleSliderChange",
      "change @ui.slider": "handleSliderChange",
      "change @ui.text": "handleTextboxChange",
      "dblclick @ui.slider": "resetValue",
    };
  }


  handleSliderChange() {
    const value = this.getSliderValue();
    this.ui.text.val(value);
    this.model.set(this.options.name, value);
  }


  handleTextboxChange(evt) {
    const value = parseFloat(evt.target.value);
    if (this.options.min <= value && value <= this.options.max) {
      this.model.set(this.options.name, value);
    } else {
      // reset to slider value
      this.update(this.model, this.getSliderValue());
    }
  }


  update(model, value) {
    value = parseFloat(value);
    this.ui.text.val(value);

    if (this.options.logScaleBase) {
      value = Math.log(value) / Math.log(this.options.logScaleBase);
    }
    this.ui.slider.val(value);
  }


  getSliderValue() {
    let value = parseFloat(this.ui.slider.val());
    if (this.options.logScaleBase != null) {
      value = Math.pow(this.options.logScaleBase, value);
    }
    return value;
  }


  resetValue() {
    if (this.model) {
      const reset = this.model.reset;
      if (reset) {
        reset();
      }
    }
  }
}
SliderSettingView.initClass();

export default SliderSettingView;
