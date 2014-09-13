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
                  Share with link via mail
                </a>
              </div>
            </div>
          </div>
          <div class="form-group">
            <label for="restriction">Restrictions</label>
            <div class="row">
              <div class="col-md-10">
                <div class="checkbox"> <label> <input type="checkbox" checked> Allow access </label> </div>
              </div>
            </div>
            <div class="row">
              <div class="col-md-10">
                <div class="checkbox"> <label> <input type="checkbox"> Allow update </label> </div>
              </div>
            </div>
            <div class="row">
              <div class="col-md-10">
                <div class="checkbox"> <label> <input type="checkbox"> Allow download </label> </div>
              </div>
            </div>
            <div class="row">
              <div class="col-md-10">
                <div class="checkbox"> <label> <input type="checkbox"> Allow finish </label> </div>
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
    @_tracingType = @_model.tracingType
    @_tracingId   = @_model.tracingId
    @_sharingLink = undefined

  show : ->

    @$el.modal("show")

    $.ajax(url : "/api/annotations/#{@_tracingType}/#{@_tracingId}/generateLink").done((tracing) =>
      @_sharingLink = tracing.link
      @ui.sharinglink.val(@_sharingLink)
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
      window.location.href = "mailto:#{mailAuthor}?Subject=Hello%20again&body=#{mailAuthor} is sharing link with you: #{@_sharingLink}";
    )


  submit : ->

    # zbierz comboboxy
    # wez linka
    # ajax
    # toast


  merge : (url) ->

    readOnly = document.getElementById('checkbox-read-only').checked

    $.ajax(
      url: "#{url}/#{readOnly}"
    ).done( (annotation) ->

      Toast.message(annotation.messages)

      redirectUrl = if readOnly
        "/annotations/#{annotation.typ}/#{annotation.id}"
      else
        "/annotations/#{annotation.typ}/#{annotation.id}/saveMerged"

      app.router.loadURL(redirectUrl)

    ).fail( (xhr) ->
      if xhr.responseJSON
        Toast.error(xhr.responseJSON.messages[0].error)
      else
        Toast.error("Error. Please try again.")
    ).always( =>
      @toggleIcon()
    )


