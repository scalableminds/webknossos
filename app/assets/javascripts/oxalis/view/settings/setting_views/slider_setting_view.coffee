### define
./abstract_setting_view : AbstractSettingView
underscore : _
###

class SliderSettingView extends AbstractSettingView


  className : "slider-setting-view row"


  template : _.template("""
    <div class="col-sm-4">
      <%= displayName %>
    </div>
    <div class="col-sm-4">
      <input type="range" min="<%= min %>" max="<%= max %>" step="<%= step %>" value="<%= value %>">
    </div>
    <div class="col-sm-4">
      <input class="form-control" type="number" min="<%= min %>" max="<%= max %>" step="<%= step %>" value="<%= value %>">
    </div>
  """)


  ui :
    slider : "input[type=range]"
    text : "input[type=number]"


  events :
    "change @ui.slider" : "handleChange"
    "change @ui.text" : "handleChange"


  handleChange : (evt) ->

    @model.set(@options.name, (Number) evt.target.value)


  update : (model, value) ->

    @ui.slider.val(parseFloat(value))
    @ui.text.val(parseFloat(value))
