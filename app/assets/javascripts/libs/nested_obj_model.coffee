_        = require("lodash")
Backbone = require("backbone")

class NestedObjModel extends Backbone.Model
  get: (attributeString) ->
    attributes = attributeString.split(".")
    valueObj = this.attributes
    _.reduce(
      attributes
      (value, attribute) ->
        return value?[attribute]
      valueObj)


  set: (attributeString, val, options={}) =>

    # We don't handle objects for now
    if _.isObject(attributeString)
      return super(attributeString, val, options)

    @changed = {}
    @deepSet(@attributes, attributeString, val, options.silent)


  deepSet: (obj, attributeString, val, silent=false) =>

    attributes = attributeString.split(".")
    _.reduce(
      attributes
      (value, attribute, ind) =>
        if ind < attributes.length - 1
          if not value[attribute]?
            value[attribute] = {}
          return value[attribute]
        else
          # Set the value if attribute is the last key in the attributeString
          if value[attribute] != val
            oldVal = value[attribute]
            value[attribute] = val

            if not silent
              # Trigger the change in the model
              @triggerDeepChange(oldVal, val, attributeString)
              @trigger("change", @)
      obj)


  triggerDeepChange: (oldObj, newObj, deepKey) =>

    # This method only triggers the change for those parts of the object
    # that actually changed (e.g. layers.color.brightness)
    if _.isPlainObject(newObj)
      # Recursively call triggerDeepChange for each key
      _.forOwn(newObj, (value, key) =>
        @triggerDeepChange((if oldObj? then oldObj[key] else oldObj), newObj[key], "#{deepKey}.#{key}")
      )
    else if oldObj != newObj
      # Add the change to the changed object
      @deepSet(@changed, deepKey, newObj, true)
      # Trigger the change
      @trigger("change:#{deepKey}", @, newObj)

module.exports = NestedObjModel
