### define
./abstract_setting_view : AbstractSettingView
underscore : _
###

class DropdownSettingView extends AbstractSettingView


  className : "dropdown-setting-view row"


  template : _.template("""
    <div class="col-sm-6">
      <%= displayName %>
    </div>
    <div class="col-sm-6">
      <select class="form-control">
        <% _.forEach(options, function (value, index) { %>
          <option value="<%= index %>"><%= value %></option>
        <% }) %>
      </select>
    </div>
  """)


  ui :
    select : "select"


  events :
    "change @ui.select" : "handleChange"


  handleChange : (evt) ->
    console.log evt, evt.target, evt.target.value
    @model.set(@options.name, evt.target.value)


  update : (model, value) ->

    @ui.select.val(parseInt(value, 10))
