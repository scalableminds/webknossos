Backbone = require("backbone")

class UserCollection extends Backbone.Collection

  url : "/api/users"
  sortAttribute : "firstName"

module.exports = UserCollection
