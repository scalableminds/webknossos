package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import models.user.{User, UserDAO}
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
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

object ScriptSQL {
  def fromScript(s: Script) = {
    Fox.successful(ScriptSQL(
      ObjectId.fromBsonId(s._id),
      ObjectId(s._owner),
      s.name,
      s.gist,
      System.currentTimeMillis(),
      false
    ))
  }
}

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

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[ScriptSQL] =
    for {
      rOpt <- run(Scripts.filter(r => notdel(r) && r.name === name).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def insertOne(s: ScriptSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.scripts(_id, _owner, name, gist, created, isDeleted)
                         values(${s._id.id}, ${s._owner.id}, ${s.name}, ${s.gist}, ${new java.sql.Timestamp(s.created)}, ${s.isDeleted})""")
    } yield ()

  def updateOne(s: ScriptSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for { //note that s.created is skipped
      _ <- run(sqlu"""update webknossos.scripts
                          set
                            _owner = ${s._owner.id},
                            name = ${s.name},
                            gist = ${s.gist},
                            isDeleted = ${s.isDeleted}
                          where _id = ${s._id.id}""")
    } yield ()
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


object ScriptDAO {

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    for {
      scriptSQL <- ScriptSQLDAO.findOneByName(name)
      script <- Script.fromScriptSQL(scriptSQL)
    } yield script

  def findOneById(id: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Script] = findOneById(id.stringify)

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[Script] =
    for {
      scriptSQL <- ScriptSQLDAO.findOne(ObjectId(id))
      script <- Script.fromScriptSQL(scriptSQL)
    } yield script

  def insert(script: Script)(implicit ctx: DBAccessContext): Fox[Script] =
    for {
      scriptSQL <- ScriptSQL.fromScript(script)
      _ <- ScriptSQLDAO.insertOne(scriptSQL)
    } yield script


  def findAll(implicit ctx: DBAccessContext): Fox[List[Script]] =
    for {
      scriptsSQL <- ScriptSQLDAO.findAll
      scripts <- Fox.combined(scriptsSQL.map(Script.fromScriptSQL(_)))
    } yield scripts


  def update(_id: BSONObjectID, script: Script)(implicit ctx: DBAccessContext) =
    for {
      scriptSQL <- ScriptSQL.fromScript(script.copy(_id = _id))
      _ <- ScriptSQLDAO.updateOne(scriptSQL)
      updated <- findOneById(_id)
    } yield updated

  def removeById(id: String)(implicit ctx: DBAccessContext) =
    ScriptSQLDAO.deleteOne(ObjectId(id))

}
