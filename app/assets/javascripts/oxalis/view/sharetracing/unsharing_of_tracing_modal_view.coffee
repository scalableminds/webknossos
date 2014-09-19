### define
underscore : _
backbone.marionette : Marionette
libs/toast : Toast
app : app
routes : jsRoutes
###

class MergeModalView extends Backbone.Marionette.LayoutView

  className : "modal fade"
  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h3>Unshare tracing</h3>
        </div>
        <div class="modal-body container-fluid">
          <div class="form-group">
            <label for="link">You have been sharing the following link</label>
            <div class="row">
              <div class="col-md-12 link">
                <input type="text" id="sharing-link" class="file-info form-control" readonly="" >
              </div>
            </div>
          </div>
        <div class="modal-footer">
            <button class="btn btn-primary" id="submit-unsharing">Unshare</button>
        </div>
      </div>
    </div>
  """)

  events :
    "click #submit-unsharing"  : "unshare"

  ui :
    "sharinglink" : "#sharing-link"


  initialize : (options) ->

    @_model       = options._model
    @_tracingId   = $("#container").data("tracing-id")
    @_tracingType = $("#container").data("tracing-type")
    @_sharedId    = undefined


  destroyModal : ->

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hidden.bs.modal", =>
      @$el.off("hidden.bs.modal")
    )
    @$el.modal("hide")


  show : ->

    @$el.modal("show")

    $.ajax(url : "/sharedannotations/#{@_tracingType}/#{@_tracingId}/getSharedLink").done((tracing) =>
      @_sharedId = tracing.sharedData.sharedId
      @ui.sharinglink.val(tracing.sharedData.sharedLink)
    )


  unshare : ->

    data = { "sharedId" : @_sharedId }

    $.ajax(
      url : """/sharedannotations/#{@_tracingType}/#{@_tracingId}/deleteShare"""
      type: "POST"
      contentType: "application/json; charset=utf-8"
      data: JSON.stringify(data)
    ).done( (annotation) ->
      Toast.message(annotation.messages)
    ).fail( (xhr) ->
      if xhr.responseJSON
        Toast.error(xhr.responseJSON.messages[0].error)
      else
        Toast.error("Error. Please try again.")
    ).always( =>
      @destroyModal()
    )
