_          = require("lodash")
Marionette = require("backbone.marionette")

class TeamAssignmentModalItemView extends Marionette.ItemView

  tagName : "li"
  template : _.template("""
    <div class="checkbox">
      <label>
        <input type="checkbox" value="<%- name %>"><%- name %>
      </label>
    </div>
  """)

module.exports = TeamAssignmentModalItemView
