### define
underscore : _
backbone.marionette : Marionette
libs/toast : Toast
app : app
routes : jsRoutes
###

class MergeModalView extends Backbone.Marionette.LayoutView

  template : _.template("""
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h3>Share tracing</h3>
        </div>
        <div class="modal-body container-fluid">
          <div class="form-group">
            <label for="link">Link to share</label>
            <div class="row">
              <div class="col-md-12 link">
                <input type="text" id="sharing-link" class="file-info form-control" readonly="" >
              </div>
            </div>
          </div>
          <div class="form-group">
            <div class="row">
              <div class="col-md-12">
                <a id="mail-link-share" href="#" target="_top" class="fa fa-envelope">
                  Share the link via mail
                </a>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="restriction">Restrictions</label>
            <div class="row">
              <div class="col-md-10">
                <div class="checkbox"> <label> <input id="checkbox-allow-access" type="checkbox" checked="checked"> Allow access </label> </div>
              </div>
            </div>
            <div class="row">
              <div class="col-md-10">
                <div class="checkbox"> <label> <input id="checkbox-allow-update" type="checkbox"> Allow update </label> </div>
              </div>
            </div>
            <div class="row">
              <div class="col-md-10">
                <div class="checkbox"> <label> <input id="checkbox-allow-download" type="checkbox"> Allow download </label> </div>
              </div>
            </div>
            <div class="row">
              <div class="col-md-10">
                <div class="checkbox"> <label> <input id="checkbox-allow-finish" type="checkbox"> Allow finish </label> </div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-primary" id="submit-sharing">Share</button>
        </div>
      </div>
    </div>
  """)

  events :
    "click #submit-sharing"  : "submit"
    "click #mail-link-share" : "shareMail"

  ui :
    "sharinglink"            : "#sharing-link"

  initialize : (options) ->

    @_model       = options._model
    @_tracingId   = $("#container").data("tracing-id")
    @_tracingType = $("#container").data("tracing-type")
    @_sharedLink  = undefined


  show : ->

    @$el.modal("show")

    $.ajax(url : "/annotations/#{@_tracingType}/#{@_tracingId}/generateLink").done((tracing) =>
      @_sharedLink = tracing.sharedLink
      @ui.sharinglink.val(@_sharedLink)
    )


  destroyModal : ->

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hidden.bs.modal", =>
      @$el.off("hidden.bs.modal")
      app.vent.trigger("CreateProjectModal:refresh") #update pagination
    )
    @$el.modal("hide")


  shareMail : ->

    $.ajax(url : "/api/user").done((user) =>
      mailAuthor = user.email
      window.location.href = "mailto:#{mailAuthor}?Subject=Hello%20again&body=#{mailAuthor} is sharing link with you: #{@_sharedLink}";
    )


  submit : ->

    allowAccess   = $('#checkbox-allow-access')  .prop('checked').toString()
    allowUpdate   = $('#checkbox-allow-update')  .prop('checked').toString()
    allowDownload = $('#checkbox-allow-download').prop('checked').toString()
    allowFinish   = $('#checkbox-allow-finish')  .prop('checked').toString()
    link = @_sharedLink

    data = { "sharedLink" : link, "restrictions" : { "allowAccess" : allowAccess, "allowUpdate" : allowUpdate, "allowDownload" : allowDownload, "allowFinish" : allowFinish} }

    $.ajax(
      url : """/annotations/#{@_tracingType}/#{@_tracingId}/saveShare"""
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


