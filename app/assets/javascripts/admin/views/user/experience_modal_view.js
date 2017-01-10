import _ from "lodash";
import $ from "jquery";
import ModalView from "../modal_view";

class ExperienceModalView extends ModalView {
  static initClass() {
    this.prototype.headerTemplate = "<h3>Change Experience</h3>";
    this.prototype.bodyTemplate = _.template(`\
<form class="form-horizontal">
  <div class="form-group">
    <label class="col-sm-2 control-label" for="experience-domain">Domain</label>
    <div class="col-sm-10">
      <input type="text" class="form-control" name="experience-domain" autocomplete="off" required autofocus>
    </div>
  </div>
  <div class="form-group">
    <label class="col-sm-2 control-label" for="experience-value">Level</label>
    <div class="col-sm-10">
      <input type="number" class="form-control" name="experience-value" value="0">
    </div>
  </div>
</form>\
`);
    this.prototype.footerTemplate = _.template(`\
<a href="#" class="increase-experience btn btn-primary">Increase Experience</a>
<a href="#" class="set-experience btn btn-primary">Set Experience</a>
<a href="#" class="delete-experience btn btn-primary">Delete Experience</a>
<a href="#" class="btn btn-default" data-dismiss="modal">Cancel</a>\
`);

    this.prototype.events = {
      "click .set-experience": "setExperience",
      "click .delete-experience": "deleteExperience",
      "click .increase-experience": "changeExperience",
    };


    this.prototype.ui = {
      experienceValue: "input[type=number]",
      experienceDomain: "input[type=text]",
    };
  }


  initialize(options) {
    return this.userCollection = options.userCollection;
  }


  setExperience() {
    if (this.isValid()) {
      this.changeExperience(true);
    }
  }


  deleteExperience() {
    if (this.isValid()) {
      const domain = this.ui.experienceDomain.val();
      const users = this.findUsers();

      for (const user of users) {
        const experiences = _.clone(user.get("experiences"));
        if (_.isNumber(experiences[domain])) {
          delete experiences[domain];
        }

        user.save({ experiences }, { wait: true });

        this.hide();
      }
    }
  }


  changeExperience(setOnly) {
    if (this.isValid()) {
      const domain = this.ui.experienceDomain.val();
      const value = +this.ui.experienceValue.val();
      const users = this.findUsers();

      for (const user of users) {
        const experiences = _.clone(user.get("experiences"));
        if (_.isNumber(experiences[domain]) && !setOnly) {
          experiences[domain] += value;
        } else {
          experiences[domain] = value;
        }
        user.save({ experiences }, { wait: true });

        this.hide();
      }
    }
  }


  findUsers() {
    const users = $("tbody input[type=checkbox]:checked").map((i, element) => this.userCollection.findWhere({
      id: $(element).val(),
    }),
    );
    return users;
  }


  isValid() {
    const isValid = this.ui.experienceDomain.val().trim() !== "";

    // Highlight the domain textbox if it is empty
    if (!isValid) {
      this.ui.experienceDomain.focus();
    }

    return isValid;
  }
}
ExperienceModalView.initClass();


export default ExperienceModalView;
