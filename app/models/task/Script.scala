package models.task

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import models.user.UserSQLDAO
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}


case class ScriptSQL(
                    _id: ObjectId,
                    _owner: ObjectId,
                    name: String,
                    gist: String,
                    created: Long = System.currentTimeMillis(),
                    isDeleted: Boolean = false
                    ) extends FoxImplicits {

  def publicWrites(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      ownerIdBson <- _owner.toBSONObjectId.toFox
      owner <- UserSQLDAO.findOne(_owner)
      ownerJs <- owner.compactWrites
    } yield {
      Json.obj(
        "id" -> _id.toString,
        "name" -> name,
        "gist" -> gist,
        "owner" -> ownerJs
      )
    }
  }

}

object ScriptSQL {
  def fromForm(
                name: String,
                gist: String,
                _owner: String) = {

    ScriptSQL(ObjectId.generate, ObjectId(_owner), name, gist)
  }
}

object ScriptSQLDAO extends SQLDAO[ScriptSQL, ScriptsRow, Scripts] {
  val collection = Scripts

  def idColumn(x: Scripts): Rep[String] = x._Id
  def isDeletedColumn(x: Scripts): Rep[Boolean] = x.isdeleted

  override def readAccessQ(requestingUserId: ObjectId): String =
    s"(select _organization from webknossos.users_ u where u._id = _owner) = (select _organization from webknossos.users_ u where u._id = '${requestingUserId}')"

  def parse(r: ScriptsRow): Fox[ScriptSQL] =
    Fox.successful(ScriptSQL(
      ObjectId(r._Id),
      ObjectId(r._Owner),
      r.name,
      r.gist,
      r.created.getTime,
      r.isdeleted
    ))

  def insertOne(s: ScriptSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.scripts(_id, _owner, name, gist, created, isDeleted)
                         values(${s._id}, ${s._owner}, ${s.name}, ${s.gist}, ${new java.sql.Timestamp(s.created)}, ${s.isDeleted})""")
    } yield ()

  def updateOne(s: ScriptSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for { //note that s.created is skipped
      _ <- assertUpdateAccess(s._id)
      _ <- run(sqlu"""update webknossos.scripts
                          set
                            _owner = ${s._owner},
                            name = ${s.name},
                            gist = ${s.gist},
                            isDeleted = ${s.isDeleted}
                          where _id = ${s._id}""")
    } yield ()

  override def findAll(implicit ctx: DBAccessContext): Fox[List[ScriptSQL]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from webknossos.scripts_ where #${accessQuery}".as[ScriptsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
}
