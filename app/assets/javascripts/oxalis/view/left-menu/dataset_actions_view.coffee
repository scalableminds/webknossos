### define
backbone.marionette : marionette
app : app
libs/toast : Toast
###

class DatsetActionsView extends Backbone.Marionette.ItemView

  template : _.template("""
    <div class="col-sm-3">
      <% if(allowUpdate){ %>
        <a href="#" class="btn btn-primary" id="trace-save-button">Save</a>
      <% } else { %>
        <button class="btn btn-primary disabled">Read only</button>
      <% } %>
    </div>
    <div class="col-sm-9">
      <div class="btn-group btn-group-justified">
        <% if(allowFinish) { %>
          <a href="/annotations/<%= tracingType %>/<%= tracingId %>/finishAndRedirect" class="btn btn-default" id="trace-finish-button"><i class="fa fa-check-circle-o"></i>Finish</a>
        <% } %>
        <a href="/annotations/<%= tracingType %>/<%= tracingId %>/download" class="btn btn-default" id="trace-download-button"><i class="fa fa-download"></i>NML</a>
        <a href="#help-modal" class="btn btn-default" data-toggle="modal"><i class="fa fa-question-circle"></i>Help</a>
          <div id="help-modal" class="modal fade">
            <div class="modal-dialog modal-lg">
              <div class="modal-content">
                <div class="modal-header">
                  <button type="button" class="close" data-dismiss="modal">×</button>
                  <h3>Keyboard Shortcuts</h3>
                </div>
                <div class="modal-body" id="help-modal-body">
                  <table class="table table-striped table-hover">
                    <thead>
                      <tr>
                        <th>Key binding</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>Left click or Arrow keys</td><td>Move</td></tr>
                      <tr><td>Right click</td><td>Set tracepoint</td></tr>
                      <tr><td>F, D</td><td>Move along Z-Axis</td></tr>
                      <tr><td>I, O or Alt + Mousewheel</td><td>Zoom in/out</td></tr>
                      <tr><td>K, L</td><td>Scale up/down viewport size</td></tr>
                      <tr><td>B, J</td><td>Set/Jump to last branchpoint</td></tr>
                    </tbody>
                  </table>
                  <p>For a full list of all keyboard shortcuts <a href="/help/keyboardshortcuts">see the help section.</a></p>
                  <p>We encourage you to read the <a href="/help/faq">FAQ</a> or the <a href="#">tutorials</a> to completely understand how Oxalis works.</p>
                  <p>All other settings like moving speed, clipping distance and particle size can be adjusted in the settings tab located to the left.</p>
                </div>
                <div class="modal-footer">
                  <a href="#" class="btn btn-default" data-dismiss="modal">Close</a>
                </div>
              </div>
            </div>
          </div>
      </div>
    </div>
  """)

  events :
    "click #trace-finish-button" : "finishTracing"
    "click #trace-download-button" : "downloadTracing"
    "click #trace-save-button" : "saveTracing"
    "click #trace-finish-button" : "finishTracing"

  initialize : (options) ->

    {@_model, @tracingType, @tracingId} = options


  serializeData : ->

    if @_model.restrictions


  finishTracing : (event) ->

    event.preventDefault()
    @saveNow().done =>
      if confirm("Are you sure you want to permanently finish this tracing?")
        window.location.href = event.target.href


  downloadTracing : (event) ->

    event.preventDefault()
    @saveNow().done =>
        window.location.href = event.currentTarget.href


  saveTracing : (event) ->

    event.preventDefault()
    app.vent.trigger("saveEverything")

