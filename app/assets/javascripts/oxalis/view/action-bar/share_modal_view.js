import _ from "lodash";
import Marionette from "backbone.marionette";
import Clipboard from "clipboard-js";
import Toast from "libs/toast";
import ModalView from "admin/views/modal_view";

class ShareModalView extends ModalView {
  static initClass() {
  
    this.prototype.headerTemplate  = "<h3>Share</h3>";
    this.prototype.bodyTemplate  = _.template(`\
<div class="form-group">
  <label for="task">Shareable Link</label>
  <div class="row">
    <div class="col-md-12">
      <div class="input-group">
        <input type="text" class="form-control" readonly value="<%- getUrl() %>"></input>
        <span class="input-group-btn">
          <button class="btn btn-default copy-btn" type="button"><i class="fa fa-copy"></i>Copy</button>
        </span>
      </div>
    </div>
  </div>
</div>\
`);
  
  
    this.prototype.templateContext  =
      {getUrl() { return ShareModalView.prototype.getUrl(); }};
  
  
    this.prototype.events  = {
      "click input" : "copyToClipboard",
      "click .copy-btn" : "copyToClipboard"
    };
  }


  getUrl() {

    const loc = window.location;

    // in readonly mode the pathname already contains "/readonly"
    let { pathname } = loc;
    pathname = pathname.replace("/readOnly", "");

    const url = loc.origin + pathname + "/readOnly" + loc.hash;
    return url;
  }


  copyToClipboard() {

    const url = this.getUrl();
    return Clipboard.copy(url).then(
      () => Toast.success("Position copied to clipboard"));
  }
}
ShareModalView.initClass();

export default ShareModalView;
