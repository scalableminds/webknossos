package models.binary

import models.basics._
import models.user.{UserService, User}
import play.api.libs.json.{Json, JsObject}
import braingames.util.FoxImplicits
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import braingames.reactivemongo.{GlobalAccessContext, DBAccessContext}
import play.modules.reactivemongo.json.BSONFormats._
import braingames.binary.models.UserDataLayer

object UserDataLayerDAO extends SecuredBaseDAO[UserDataLayer] {

  val collectionName = "userDataLayers"

  val formatter = UserDataLayer.userDataLayerFormat

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("dataLayer.name", name)
}