$ = require("jquery")

Modal =

  callbacks : {}

  show : (text, title="Ups...", buttons=[{id: "ok-button", label: "OK"}]) ->
    # buttons: [{id:..., label:..., callback:...}, ...]

    html =  """
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <h4 class="modal-title" id="myModalLabel">#{title}</h4>
        </div>
        <div class=\"modal-body\">
          <p>#{text}</p>
        </div>"""

    html += "<div class=\"modal-footer\">"
    for button in buttons
      html += "<a href=\"#\" id=\"" + button.id + "\" class=\"btn btn-default\">" +
                    button.label + "</a>"
    html += "</div></div></div>"

    $("#modal").html(html)

    for button in buttons

      @callbacks[button.id] = button.callback

      $("#" + button.id).on("click", (evt) =>

        callback = @callbacks[evt.target.id]
        if callback?
          callback()
        $("#modal").modal("hide"))

    $("#modal").modal("show")


  hide : ->

    $("#modal").modal("hide")

module.exports = Modal
