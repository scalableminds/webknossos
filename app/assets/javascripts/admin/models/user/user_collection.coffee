PaginationCollection = require("../pagination_collection")

class UserCollection extends PaginationCollection

  url : "/api/users"

  paginator_ui :
    perPage : 50

module.exports = UserCollection
