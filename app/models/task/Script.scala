package models.task

import com.scalableminds.util.Msg
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Scripts, ScriptsRow, GetResultScriptsRow}
import models.user.{UserDAO, UserService}
import play.api.libs.json._
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class Script(
    _id: ObjectId,
    _owner: ObjectId,
    name: String,
    gist: String,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
)

class ScriptService @Inject() (userDAO: UserDAO, userService: UserService) {

  def publicWrites(script: Script): Fox[JsObject] = {
    implicit val ctx: GlobalAccessContext.type = GlobalAccessContext
    for {
      owner <- userDAO.findOne(script._owner) ?~> Msg.User.notFound(script._owner)
      ownerJs <- userService.compactWrites(owner)
    } yield Json.obj(
      "id" -> script._id.toString,
      "name" -> script.name,
      "gist" -> script.gist,
      "owner" -> ownerJs
    )
  }

  def assertValidScriptName(scriptName: String)(implicit ec: ExecutionContext): Fox[Unit] =
    for {
      _ <- Fox.fromBool(scriptName.length >= 2) ?~> Msg.Script.nameTooShort
      _ <- Fox.fromBool(scriptName.length <= 50) ?~> Msg.Script.nameTooLong
      _ <- Fox.fromBool(scriptName.matches("^[A-Za-z0-9\\-_\\. ß]+$")) ?~> Msg.Script.nameInvalidChars(scriptName)
    } yield ()
}

class ScriptDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Script, ScriptsRow, Scripts](sqlClient) {
  protected val collection = Scripts
  protected def resultConverter = GetResultScriptsRow

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"(SELECT _organization FROM webknossos.users_ u WHERE u._id = _owner) = (SELECT _organization FROM webknossos.users_ u WHERE u._id = $requestingUserId)"

  protected def parse(r: ScriptsRow): Fox[Script] =
    Fox.successful(
      Script(
        ObjectId(r._Id),
        ObjectId(r._Owner),
        r.name,
        r.gist,
        Instant.fromSql(r.created),
        r.isdeleted
      )
    )

  def insertOne(s: Script): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.scripts(_id, _owner, name, gist, created, isDeleted)
                   VALUES(${s._id}, ${s._owner}, ${s.name}, ${s.gist}, ${s.created}, ${s.isDeleted})""".asUpdate)
    } yield ()

  def updateOne(s: Script)(using ctx: DBAccessContext): Fox[Unit] =
    for { // note that s.created is skipped
      _ <- assertUpdateAccess(s._id)
      _ <- run(q"""UPDATE webknossos.scripts
                   SET
                     _owner = ${s._owner},
                     name = ${s.name},
                     gist = ${s.gist},
                     isDeleted = ${s.isDeleted}
                   WHERE _id = ${s._id}""".asUpdate)
    } yield ()

}
