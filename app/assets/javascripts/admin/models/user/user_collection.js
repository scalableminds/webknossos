import SortedCollection from "admin/models/sorted_collection";

class UserCollection extends SortedCollection {
  static initClass() {
    this.prototype.url = "/api/users";
    this.prototype.sortAttribute = "lastName";
  }
}
UserCollection.initClass();

export default UserCollection;
