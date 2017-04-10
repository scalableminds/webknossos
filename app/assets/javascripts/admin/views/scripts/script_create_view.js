import _ from "lodash";
import app from "app";
import FormSyphon from "form-syphon";
import Marionette from "backbone.marionette";
import "bootstrap-multiselect";
import TeamCollection from "admin/models/team/team_collection";
import SelectionView from "admin/views/selection_view";
import Toast from "libs/toast";

class ScriptCreateView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\

`);
    this.prototype.className = "container wide task-types-administration";

    this.prototype.regions =
      { team: ".team" };

    this.prototype.events =
      { "submit form": "submitForm" };

    this.prototype.ui = {
      form: "form",
      multiselect: "select[multiple='multiple']",
    };
  }

  templateContext() {
    return {
      getTitle: () => this.isEditingMode ? "Update" : "Create",
      isChecked(bool) { return bool ? "checked" : ""; },
      isSelected(bool) { return bool ? "selected" : ""; },
    };
  }


  initialize() {
    this.isEditingMode = _.isString(this.model.id);

    if (this.isEditingMode) {
      this.listenTo(this.model, "sync", this.render);
      this.model.fetch();
    }
  }


  submitForm(event) {
    event.preventDefault();

    if (!this.ui.form[0].checkValidity()) {
      Toast.error("Please supply all needed values.");
      return;
    }


    const formValues = FormSyphon.serialize(this.ui.form);
    if (formValues.settings.preferredMode === "Any") { formValues.settings.preferredMode = null; }

    // Add 'required' attribute to select once it's supported
    // https://github.com/davidstutz/bootstrap-multiselect/issues/620
    if (_.isEmpty(formValues.settings.allowedModes)) {
      Toast.error("Please provide at least one allowed mode.");
      return;
    }


    this.model.save(formValues).then(
      () => app.router.navigate("/taskTypes", { trigger: true }));
  }


  onRender() {
    const teamSelectionView = new SelectionView({
      collection: new TeamCollection(),
      childViewOptions: {
        modelValue() { return `${this.model.get("name")}`; },
        defaultItem: { name: this.model.get("team") },
      },
      data: "amIAnAdmin=true",
      name: "team",
      required: true,
    });
    this.showChildView("team", teamSelectionView);

    this.ui.multiselect.multiselect();
  }


  onBeforeDestroy() {
    this.ui.multiselect.multiselect("destroy");
  }
}
ScriptCreateView.initClass();


export default ScriptCreateView;
