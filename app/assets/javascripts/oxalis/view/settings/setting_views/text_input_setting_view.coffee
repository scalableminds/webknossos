_                   = require("lodash")
Marionette          = require("backbone.marionette")
AbstractSettingView = require("./abstract_setting_view")

class TextInputSettingView extends AbstractSettingView


  className : "text-setting-view row"


  template : _.template("""
    <div class="col-sm-5">
      <%- displayName %>
    </div>
    <div class="col-sm-7">
      <input class="form-control" type="text" pattern="<%- pattern %>" title="<%- title %>" value="<%- value %>">
    </div>
  """)


  ui :
    text : "input[type=text]"


  events :
    "change @ui.text" : "handleChange"


  initialize : (options) ->

    super(options)

    _.defaults(@options,
      pattern : ""
      title : ""
    )

  handleChange : (evt) ->

    value = evt.target.value

    if @options.validate
      return if not @options.validate.call(@, value)

    @model.set(@options.name, value)


  update : (model, value) ->

    @ui.text.val(value)

module.exports = TextInputSettingView
