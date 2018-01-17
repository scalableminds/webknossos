package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import models.basics.SecuredBaseDAO
import models.user.{User, UserDAO}
import play.api.i18n.Messages
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import play.api.Play.current
import play.api.i18n.Messages.Implicits._
import reactivemongo.play.json.BSONFormats._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

import scala.concurrent.Future


case class ScriptSQL(
                    _id: ObjectId,
                    _owner: ObjectId,
                    name: String,
                    gist: String,
                    created: Long = System.currentTimeMillis(),
                    isDeleted: Boolean = false
                    )



object ScriptSQLDAO extends SQLDAO[ScriptSQL, ScriptsRow, Scripts] {
  val collection = Scripts

  def idColumn(x: Scripts): Rep[String] = x.name
  def isDeletedColumn(x: Scripts): Rep[Boolean] = x.isdeleted

  def parse(r: ScriptsRow): Fox[ScriptSQL] =
    Fox.successful(ScriptSQL(
      ObjectId(r._Id),
      ObjectId(r._Owner),
      r.name,
      r.gist,
      r.created.getTime,
      r.isdeleted
    ))
}


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

  def fromScriptSQL(s: ScriptSQL)(implicit ctx: DBAccessContext): Fox[Script] = {
    for {
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
    } yield {
      Script(
        s.name,
        s.gist,
        s._owner.toString,
        idBson
      )
    }

  }
}

object ScriptDAO extends SecuredBaseDAO[Script] with FoxImplicits {
  val collectionName = "scripts"

  implicit val formatter = Script.scriptFormat

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)
}
