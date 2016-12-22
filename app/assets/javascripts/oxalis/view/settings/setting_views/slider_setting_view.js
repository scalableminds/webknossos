_                   = require("lodash")
Marionette          = require("backbone.marionette")
AbstractSettingView = require("./abstract_setting_view")

class SliderSettingView extends AbstractSettingView


  className : "slider-setting-view row"


  template : _.template("""
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
    </div>
  """)


  ui :
    slider : "input[type=range]"
    text : "input[type=number]"


  events :
    "input @ui.slider" : "handleSliderChange"
    "change @ui.slider" : "handleSliderChange"
    "change @ui.text" : "handleTextboxChange"
    "dblclick @ui.slider" : "resetValue"


  handleSliderChange : (evt) ->

    value = @getSliderValue()
    @ui.text.val(value)
    @model.set(@options.name, value)


  handleTextboxChange : (evt) ->

    value = parseFloat(evt.target.value)
    if @options.min <= value <= @options.max
      @model.set(@options.name, value)
    else
      # reset to slider value
      @update(@model, @getSliderValue())


  update : (model, value) ->

    value = parseFloat(value)
    @ui.text.val(value)

    if @options.logScaleBase
      value = Math.log(value) / Math.log(@options.logScaleBase)
    @ui.slider.val(value)


  getSliderValue : ->

    value = parseFloat(@ui.slider.val())
    if @options.logScaleBase?
      value = Math.pow(@options.logScaleBase, value)
    return value


  resetValue : (evt) ->

    if @model
      if reset = @model.reset
        reset()

module.exports = SliderSettingView
