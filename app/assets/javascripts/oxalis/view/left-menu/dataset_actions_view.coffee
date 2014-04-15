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

    @listenTo(app.vent, "model:sync", ->

      @render()
    )

  serializeData : ->

    #TODO refactor / remvove after deepmodel
    defaults =
      allowUpdate : false
      allowFinish : false
      tracingType : @tracingType
      tracingId : @tracingId

    if @_model.restrictions
      return _.extend(defaults, @_model.restrictions)
    else
      return defaults


  finishTracing : (event) ->

    event.preventDefault()
    @saveNow().done =>
      if confirm("Are you sure you want to permanently finish this tracing?")
        window.location.href = event.target.href


  downloadTracing : (event) ->

    event.preventDefault()
    @saveNow().done =>
        window.location.href = event.target.href


  saveTracing : (event) ->

    event.preventDefault()
    @saveNow()


  #TODO this shouldn't be here
  saveNow : =>

    @_model.user.pushImpl()
    model = @_model.skeletonTracing || @_model.volumeTracing

    if @_model.restrictions.allowUpdate and model?
      model.stateLogger.pushNow()
        .then(
          -> Toast.success("Saved!")
          -> Toast.error("Couldn't save. Please try again.")
        )
    else
      new $.Deferred().resolve()

