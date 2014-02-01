### define
underscore : _
backbone.marionette : marionette
###

class ExperienceModal extends Backbone.Marionette.ItemView

  tagName : "div"
  className : "modal hide fade"
  template : _.template("""
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h3>Change Experience</h3>
    </div>
    <div class="modal-body form-horizontal">
      <fieldset data-validation-group>
        <div class="control-group">
          <label class="control-label" for="experience-domain">Domain</label>
          <div class="controls">
            <input type="text" class="input-small" name="experience-domain" autocomplete="off" required data-invalid-message="Please enter a experience domain.">
          </div>
        </div>
        <div class="control-group">
          <label class="control-label" for="experience-value">Value</label>
          <div class="controls">
            <input type="number" class="input-small" name="experience-value" value="0" required data-invalid-message="Please specify a experience value.">
          </div>
        </div>
        <div class="btn-group">
          <a href="changeExperience" class="change-experience btn modal-hide">
          Increase Experience
          </a>
          <a href="#" class="change-experience btn modal-hide">
            Set Experience
          </a>
          <a href="#" class="change-experience btn modal-hide">
            Delete Experience
          </a>
        </div>
      </fieldset>
    </div>
  """)

  events :
    "click .change-experience" : "changeExperience"

  initalize : ->

  changeExperience : ->

#data-source='@Json.stringify(Json.toJson(experiences))' data-provide="typeahead"