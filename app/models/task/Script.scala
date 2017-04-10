package models.task

import com.scalableminds.util.reactivemongo.AccessRestrictions.{DenyEveryone, AllowIf}
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DefaultAccessDefinitions, DBAccessContext}
import models.basics.SecuredBaseDAO
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.{UserDAO, UserService, User}
import play.api.libs.functional.syntax._
import play.api.data.validation.ValidationError
import scala.util.{Failure, Success}
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._

case class Script(
  name: String,
  gist: String,
  _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id = _id.stringify
}

object Script extends FoxImplicits {

  implicit val scriptFormat = Json.format[Script]

  def fromForm(
    name: String,
    gist: String) = {

    Script(name, gist)
  }
}

object ScriptDAO extends SecuredBaseDAO[Script] with FoxImplicits {
  val collectionName = "scripts"

  implicit val formatter = Script.scriptFormat

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)
}
