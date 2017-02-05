/**
 * nested_obj_model.js
 * @flow weak
 */

import _ from "lodash";
import Utils from "libs/utils";
import Backbone from "backbone";

class NestedObjModel extends Backbone.Model {

  changed: Object;
  superSetFunction: (attributeString: string, val: any, options: Object) => any;

  constructor(...args) {
    super(...args);
    this.superSetFunction = super.set;
  }

  get(attributeString) {
    const attributes = attributeString.split(".");
    const valueObj = this.attributes;
    return _.reduce(
      attributes,
      (value, attribute) => Utils.__guard__(value, x => x[attribute]),
      valueObj);
  }


  set = (attributeString: string, val: any, options: Object = {}) => {
    // We don't handle objects for now
    if (_.isObject(attributeString)) {
      return this.superSetFunction(attributeString, val, options);
    }

    this.changed = {};
    return this.deepSet(this.attributes, attributeString, val, options.silent);
  }


  deepSet = (obj, attributeString, val, silent = false) => {
    const attributes = attributeString.split(".");
    _.reduce(
      attributes,
      (value, attribute, ind) => {
        if (ind < attributes.length - 1) {
          if (value[attribute] == null) {
            value[attribute] = {};
          }
          return value[attribute];
        } else if (value[attribute] !== val) {
          // Set the value if attribute is the last key in the attributeString
          const oldVal = value[attribute];
          value[attribute] = val;

          if (!silent) {
            // Trigger the change in the model
            this.triggerDeepChange(oldVal, val, attributeString);
            this.trigger("change", this);
          }
        }
        return null;
      },
      obj);
  }


  triggerDeepChange = (oldObj, newObj, deepKey) => {
    // This method only triggers the change for those parts of the object
    // that actually changed (e.g. layers.color.brightness)
    if (_.isPlainObject(newObj)) {
      // Recursively call triggerDeepChange for each key
      _.forOwn(newObj, (value, key) => this.triggerDeepChange(((oldObj != null) ? oldObj[key] : oldObj), newObj[key], `${deepKey}.${key}`),
      );
    } else if (oldObj !== newObj) {
      // Add the change to the changed object
      this.deepSet(this.changed, deepKey, newObj, true);
      // Trigger the change
      this.trigger(`change:${deepKey}`, this, newObj);
    }
  }
}

export default NestedObjModel;
