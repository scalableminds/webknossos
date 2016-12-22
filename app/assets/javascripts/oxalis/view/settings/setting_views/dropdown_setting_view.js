_                   = require("lodash")
Marionette          = require("backbone.marionette")
AbstractSettingView = require("./abstract_setting_view")

class DropdownSettingView extends AbstractSettingView


  className : "dropdown-setting-view row"


  template : _.template("""
    <div class="col-sm-5">
      <%- displayName %>
    </div>
    <div class="col-sm-7">
      <select class="form-control">
        <% _.forEach(options, function (name, index) { %>
          <option value="<%- index %>" <%- isSelected(value, index) %>><%- name %></option>
        <% }) %>
      </select>
    </div>
  """)


  templateContext :
    isSelected : (value, index) ->
      return if value == index then "selected" else ""


  ui :
    select : "select"


  events :
    "change @ui.select" : "handleChange"


  handleChange : (evt) ->
    @model.set(@options.name, parseInt(evt.target.value, 10))


  update : (model, value) ->

    @ui.select.val(parseInt(value, 10))

module.exports = DropdownSettingView
