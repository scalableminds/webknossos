_        = require("lodash")
backbone = require("backbone")

class CommentsCollection extends Backbone.Collection


  intitalize : ->

    @coefficient = 1


  comparator : (model) ->

    return model.get("node") * @coefficient


  sort : (isAscending) ->

    @coefficient = if isAscending then 1 else -1
    super()


  findCommentByNodeId : (id) ->

    return @findWhere({ node: id })


  hasCommentWithNodeId : (id) ->

    return @findCommentByNodeId(id) != undefined

module.exports = CommentsCollection
