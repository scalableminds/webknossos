AbstractSettingView = require("./abstract_setting_view")
_                   = require("lodash")

class SliderSettingView extends AbstractSettingView


  className : "slider-setting-view row"


  template : _.template("""
    <div class="col-sm-5">
      <%- displayName %>
    </div>
    <div class="col-sm-3 no-gutter v-center">
      <div class="v-center-agent">
        <input type="range" min="<%- min %>" max="<%- max %>" step="<%- step %>" value="<%- value %>">
      </div>
    </div>
    <div class="col-sm-4">
      <input class="form-control" type="number" min="<%- min %>" max="<%- max %>" step="<%- step %>" value="<%- value %>">
    </div>
  """)


  ui :
    slider : "input[type=range]"
    text : "input[type=number]"


  events :
    "input @ui.slider" : "handleSliderChange"
    "change @ui.slider" : "handleChange"
    "change @ui.text" : "handleChange"
    "dblclick @ui.slider" : "resetValue"


  handleSliderChange : (evt) ->

    @ui.text.val(evt.target.value)
    @handleChange(evt)


  handleChange : (evt) ->

    @model.set(@options.name, (Number) evt.target.value)


  update : (model, value) ->

    @ui.slider.val(parseFloat(value))
    @ui.text.val(parseFloat(value))


  resetValue : (evt) ->

    if @model
      if reset = @model.reset
        reset()

module.exports = SliderSettingView
