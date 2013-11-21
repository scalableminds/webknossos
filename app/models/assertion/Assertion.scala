package models.assertion

import models.basics._
import models.user.{UserService, User}
import play.api.libs.json.{Json, JsObject}
import braingames.util.FoxImplicits
import play.api.libs.concurrent.Execution.Implicits._
import reactivemongo.bson.BSONObjectID
import braingames.reactivemongo.DBAccessContext
import play.modules.reactivemongo.json.BSONFormats._

case class Assertion(
                      _user: Option[BSONObjectID],
                      timestamp: Long,
                      value: String,
                      title: String,
                      message: String,
                      stacktrace: String,
                      globalContext: String,
                      localContext: String,
                      _id: BSONObjectID = BSONObjectID.generate
                    ) extends FoxImplicits {

  def id = _id.stringify

  def user = _user.toFox.flatMap(id => UserService.findOneById(id.stringify, useCache = true))
}

object Assertion {
  implicit val assertionFormat = Json.format[Assertion]
}

object AssertionDAO extends SecuredBaseDAO[Assertion] {

  val collectionName = "assertions"

  val formatter = Assertion.assertionFormat

  def findAllSortedByTimestamp()(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj())
    .sort(Json.obj("timestamp" -> -1))
    .cursor[Assertion]
    .collect[List]()
  }
}