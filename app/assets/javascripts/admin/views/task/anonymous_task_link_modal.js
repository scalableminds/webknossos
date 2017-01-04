import $ from "jquery";
import _ from "lodash";
import Clipboard from "clipboard-js";
import Marionette from "backbone.marionette";
import Toast from "libs/toast";
import ModalView from "admin/views/modal_view";


class AnonymousTaskListModal extends ModalView {
  static initClass() {
    this.prototype.headerTemplate = _.template("<h3>Anonymous Task Links for Task <%- id %></h3>");
    this.prototype.bodyTemplate = _.template(`\
    <textarea class="form-control" style="min-height: 200px">
<%- directLinks.join("\\n") %>
    </textarea>\
`);
    this.prototype.footerTemplate = `\
<a href="#" class="btn btn-primary"><i class="fa fa-copy"></i>Copy</a>
<a href="#" class="btn btn-default" data-dismiss="modal">Close</a>\
`;

    this.prototype.events =
      { "click .btn-primary": "copyToClipboard" };
  }


  copyToClipboard(evt) {
    evt.preventDefault();

    const links = this.model.get("directLinks").join("\n");
    return Clipboard.copy(links).then(
      () => Toast.success("Links copied to clipboard"));
  }
}
AnonymousTaskListModal.initClass();

export default AnonymousTaskListModal;
