_                   = require("lodash")
Marionette          = require("backbone.marionette")
AbstractSettingView = require("./abstract_setting_view")

class NumberSettingView extends AbstractSettingView


  className : "number-setting-view row"


  template : _.template("""
    <div class="col-sm-5">
      <%- displayName %>
    </div>
    <div class="col-sm-7">
      <input class="form-control" type="number" min="<%- min %>" max="<%- max %>" step="<%- step %>" value="<%- value %>">
    </div>
  """)


  ui :
    number : "input[type=number]"


  events :
    "change @ui.number" : "handleChange"


  initialize : (options) ->

    super(options)

    _.defaults(@options,
      min : ""
      max : ""
      step : 1
    )


  handleChange : (evt) ->

    @model.set(@options.name, (Number) evt.target.value)


  update : (model, value) ->

    @ui.number.val(value)

module.exports = NumberSettingView
