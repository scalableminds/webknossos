package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import models.user.{User, UserDAO}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

import scala.concurrent.Future

case class Script(
  name: String,
  gist: String,
  _owner: String,
  _id: BSONObjectID = BSONObjectID.generate) {

  lazy val id: String = _id.stringify
}

object Script extends FoxImplicits {

  implicit val scriptFormat = Json.format[Script]

  def fromForm(
    name: String,
    gist: String,
    _owner: String) = {

    Script(name, gist, _owner)
  }

  def scriptPublicWrites(script: Script)(implicit ctx: DBAccessContext): Future[JsObject] =
    for {
      owner <- UserDAO.findOneById(script._owner).map(User.userCompactWrites.writes).futureBox
    } yield {
      Json.obj(
        "id" -> script.id,
        "name" -> script.name,
        "gist" -> script.gist,
        "owner" -> owner.toOption
      )
    }
}

object ScriptDAO extends SecuredBaseDAO[Script] with FoxImplicits {
  val collectionName = "scripts"

  implicit val formatter = Script.scriptFormat

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)
}
