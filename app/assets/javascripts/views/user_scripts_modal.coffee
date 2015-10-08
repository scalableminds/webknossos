_          = require("underscore")
Marionette = require("backbone.marionette")

class UserScriptsModalView extends Backbone.Marionette.ItemView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal">&times;</button>
          <h3>Add user script</h3>
        </div>
        <div class="modal-body" id="help-modal-body">
          <textarea id="add-script-input" rows="10"></textarea>
        </div>
        <div class="modal-footer">
          <a href="#" id="add-script-button" class="btn btn-default">Add</a>
          <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
        </div>
      </div>
    </div>
  """)

module.exports = UserScriptsModalView
