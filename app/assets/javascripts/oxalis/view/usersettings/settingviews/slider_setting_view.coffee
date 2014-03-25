### define
./abstract_setting_view : AbstractSettingView
underscore : _
###

class SliderSettingView extends AbstractSettingView


  template : _.template("""
    <label>
      <input type="range" min="<%= min %>" max="<%= max %>"> <%= displayName %>
    </label>
  """)


  events :
    "change [type=range]" : "handleSliderChange"


  handleSliderChange : (evt) ->

    console.log evt.target.value
    @model.set(@options.name, evt.target.value)
