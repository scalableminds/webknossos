### define
./abstract_setting_view : AbstractSettingView
underscore : _
###

class SliderSettingView extends AbstractSettingView


  className : "slider-setting-view"


  template : _.template("""
    <label>
      <p><%= displayName %></p>
      <input type="range" min="<%= min %>" max="<%= max %>" step="<%= step %>" value="<%= value %>">
      <input type="number" min="<%= min %>" max="<%= max %>" step="<%= step %>" value="<%= value %>">
    </label>
  """)


  ui :
    slider : "input[type=range]"
    text : "input[type=number]"


  events :
    "change @ui.slider" : "handleChange"
    "change @ui.text" : "handleChange"


  handleChange : (evt) ->

    @model.set(@options.name, evt.target.value)


  update : (@model, value) ->

    @ui.slider.val(value)
    @ui.text.val(value)
