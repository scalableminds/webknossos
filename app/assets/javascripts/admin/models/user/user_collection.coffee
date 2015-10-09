_                    = require("lodash")
Backbone             = require("backbone")
UserModel            = require("./user_model")
PaginationCollection = require("../pagination_collection")

class UserCollection extends PaginationCollection

  url : "/api/users"
  model : UserModel

  paginator_ui :
    perPage : 50

module.exports = UserCollection
