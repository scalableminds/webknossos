_        = require("underscore")
Backbone = require("backbone")

class NestedObjModel extends Backbone.Model
  get: (attributeString) ->
    attributes = attributeString.split(".")
    valueObj = this.attributes
    _.reduce(
      attributes
      (value, attribute) ->
        value[attribute]
      valueObj)

module.exports = NestedObjModel
