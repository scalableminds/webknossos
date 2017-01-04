import $ from "jquery";

const Modal = {

  callbacks : {},

  show(text, title = "Ups...", buttons = [{id: "ok-button", label: "OK"}]) {
    // buttons: [{id:..., label:..., callback:...}, ...]

    let html =  `\
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h4 class="modal-title" id="myModalLabel">${title}</h4>
    </div>
    <div class=\"modal-body\">
      <p>${text}</p>
    </div>`;

    html += "<div class=\"modal-footer\">";
    for (var button of buttons) {
      html += `<a href="#" id="${button.id}" class="btn btn-default">` +
                    button.label + "</a>";
    }
    html += "</div></div></div>";

    $("#modal").html(html);

    for (button of buttons) {

      this.callbacks[button.id] = button.callback;

      $(`#${button.id}`).on("click", evt => {

        const callback = this.callbacks[evt.target.id];
        if (callback != null) {
          callback();
        }
        return $("#modal").modal("hide");
      });
    }

    return $("#modal").modal("show");
  },


  hide() {

    return $("#modal").modal("hide");
  }
};

export default Modal;
