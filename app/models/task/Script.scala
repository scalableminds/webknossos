package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.FoxImplicits
import models.basics.SecuredBaseDAO
import play.api.libs.functional.syntax._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

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

  def scriptPublicWrites: Writes[Script] =
    ((__ \ "id").write[String] and
      (__ \ "gist").write[String] and
      (__ \ "name").write[String] and
      (__ \ "owner").write[String])(s =>
      (s.id, s.gist, s.name, s._owner))
}

object ScriptDAO extends SecuredBaseDAO[Script] with FoxImplicits {
  val collectionName = "scripts"

  implicit val formatter = Script.scriptFormat

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)
}
