/**
 * modal.js
 * @flow
 */

import $ from "jquery";

type ButtonType = {
  id: string;
  label: string;
  callback?: (()=>void);
}

const Modal = {

  callbacks: {},

  show(text: string, title: string = "Ups...", buttons:Array<ButtonType> = [{ id: "ok-button", label: "OK" }]) {
    // buttons: [{id:..., label:..., callback:...}, ...]

    let html = `\
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h4 class="modal-title" id="myModalLabel">${title}</h4>
    </div>
    <div class="modal-body">
      <p>${text}</p>
    </div>`;

    html += "<div class=\"modal-footer\">";
    for (const button of buttons) {
      html += `<a href="#" id="${button.id}" class="btn btn-default">${
                    button.label}</a>`;
    }
    html += "</div></div></div>";

    $("#modal").html(html);

    for (const button of buttons) {
      this.callbacks[button.id] = button.callback;

      $(`#${button.id}`).on("click", (evt) => {
        if(!(evt.target instanceof window.HTMLElement)){
          return
        }
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
  },
};

export default Modal;
