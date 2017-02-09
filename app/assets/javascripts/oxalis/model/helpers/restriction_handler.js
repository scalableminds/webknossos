/**
 * restriction_handler.js
 * @flow weak
 */

import Toast from "libs/toast";
import type { RestrictionsType } from "oxalis/model";

const UPDATE_ERROR = "You cannot update this tracing, because you are in Read-only mode!";
const UPDATE_WARNING = "This change will not be persisted, because your are in Read-only mode!";

class RestrictionHandler {

  restrictions: RestrictionsType;
  issuedUpdateError: boolean;
  issuedUpdateWarning: boolean;

  constructor(restrictions) {
    this.restrictions = restrictions;
    this.issuedUpdateError = false;
    this.issuedUpdateWarning = false;
  }

  // Should be called whenever the model is modified
  // Returns whether the modification is allowed
  // ==> return if not @restrictionHandler.updateAllowed()
  updateAllowed(error = true) {
    if (this.restrictions.allowUpdate) {
      return true;
    } else {
      // Display error or warning if it wasn't displayed before
      if (error) {
        if (!this.issuedUpdateError) {
          Toast.error(UPDATE_ERROR);
          this.issuedUpdateError = true;
        }
      } else if (!this.issuedUpdateWarning) {
        Toast.warning(UPDATE_WARNING);
        this.issuedUpdateWarning = true;
      }
      return false;
    }
  }
}

export default RestrictionHandler;
