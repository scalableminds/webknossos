package models.project

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext, JsonFormatHelper}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{AnnotationState, AnnotationTypeSQL}
import models.task.TaskSQLDAO
import models.team.{Team, TeamDAO, TeamSQLDAO}
import models.user.{User, UserService}
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.{Json, _}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}

import scala.concurrent.Future


case class ProjectSQL(
                     _id: ObjectId,
                     _team: ObjectId,
                     _owner: ObjectId,
                     name: String,
                     priority: Long,
                     paused: Boolean,
                     expectedTime: Option[Long],
                     created: Long = System.currentTimeMillis(),
                     isDeleted: Boolean = false
                     ) extends FoxImplicits {

  def owner = UserService.findOneById(_owner.toString, useCache = true)(GlobalAccessContext)

  def isDeletableBy(user: User) = ObjectId.fromBsonId(user._id) == _owner || user.isAdmin

  def team(implicit ctx: DBAccessContext) = _team.toBSONObjectId.toFox.flatMap(TeamDAO.findOneById(_))

  def publicWrites: Fox[JsObject] =
    for {
      owner <- owner.map(User.userCompactWrites.writes).futureBox
      teamIdBSON <- _team.toBSONObjectId.toFox
      teamNameOpt <- TeamDAO.findOneById(teamIdBSON)(GlobalAccessContext).map(_.name).toFutureOption
    } yield {
      Json.obj(
        "name" -> name,
        "team" -> _team.toString,
        "teamName" -> teamNameOpt,
        "owner" -> owner.toOption,
        "priority" -> priority,
        "paused" -> paused,
        "expectedTime" -> expectedTime,
        "id" -> _id.toString
      )
    }

  def publicWritesWithStatus(openTaskInstances: Int)(implicit ctx: DBAccessContext): Fox[JsObject] = {
    for {
      projectJson <- publicWrites
    } yield {
      projectJson + ("numberOfOpenAssignments" -> JsNumber(openTaskInstances))
    }
  }

}

object ProjectSQL {
  private val validateProjectName = Reads.pattern("^[a-zA-Z0-9_-]*$".r, "project.name.invalidChars")

  val projectPublicReads: Reads[ProjectSQL] =
    ((__ \ 'name).read[String](Reads.minLength[String](3) keepAnd validateProjectName) and
      (__ \ 'team).read[String](JsonFormatHelper.StringObjectIdReads("team")) and
      (__ \ 'priority).read[Int] and
      (__ \ 'paused).readNullable[Boolean] and
      (__ \ 'expectedTime).readNullable[Long] and
      (__ \ 'owner).read[String](JsonFormatHelper.StringObjectIdReads("owner"))) (
      (name, team, priority, paused, expectedTime, owner) =>
        ProjectSQL(ObjectId.generate, ObjectId(team), ObjectId(owner), name, priority, paused getOrElse false, expectedTime))

}

object ProjectSQLDAO extends SQLDAO[ProjectSQL, ProjectsRow, Projects] {
  val collection = Projects

  def idColumn(x: Projects): Rep[String] = x._Id
  def isDeletedColumn(x: Projects): Rep[Boolean] = x.isdeleted

  def parse(r: ProjectsRow): Fox[ProjectSQL] =
    Fox.successful(ProjectSQL(
      ObjectId(r._Id),
      ObjectId(r._Team),
      ObjectId(r._Owner),
      r.name,
      r.priority,
      r.paused,
      r.expectedtime,
      r.created.getTime,
      r.isdeleted
    ))

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""((_team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}')) or _owner = '${requestingUserId.id}'
      or (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin) = (select _organization from webknossos.users_ where _id = _owner))"""
  override def deleteAccessQ(requestingUserId: ObjectId) = s"_owner = '${requestingUserId.id}'"

  // read operations

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[ProjectSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}".as[ProjectsRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[ProjectSQL]] = {
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where #${accessQuery} order by created".as[ProjectsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[ProjectSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where name = '#${sanitize(name)}' and #${accessQuery}".as[ProjectsRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield parsed

  def findUsersWithOpenTasks(name: String)(implicit ctx: DBAccessContext): Fox[List[String]] =
    for {
      accessQuery <- readAccessQuery
      rSeq <- run(sql"""select u.email
                         from
                         webknossos.annotations_ a
                         join webknossos.tasks_ t on a._task = t._id
                         join webknossos.projects_ p on t._project = p._id
                         join webknossos.users_ u on a._user = u._id
                         where p.name = ${name}
                         and a.state = '#${AnnotationState.Active.toString}'
                         and a.typ = '#${AnnotationTypeSQL.Task}'
                         group by u.email
                     """.as[String])
    } yield rSeq.toList

  // write operations

  def insertOne(p: ProjectSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.projects(_id, _team, _owner, name, priority, paused, expectedTime, created, isDeleted)
                         values(${p._id.id}, ${p._team.id}, ${p._owner.id}, ${p.name}, ${p.priority}, ${p.paused}, ${p.expectedTime}, ${new java.sql.Timestamp(p.created)}, ${p.isDeleted})""")
    } yield ()


  def updateOne(p: ProjectSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for { //note that p.created is skipped
      _ <- assertUpdateAccess(p._id)
      _ <- run(sqlu"""update webknossos.projects
                          set
                            _team = ${p._team.id},
                            _owner = ${p._owner.id},
                            name = ${p.name},
                            priority = ${p.priority},
                            paused = ${p.paused},
                            expectedTime = ${p.expectedTime},
                            isDeleted = ${p.isDeleted}
                          where _id = ${p._id.id}""")
    } yield ()

  def updatePaused(id: ObjectId, isPaused: Boolean)(implicit ctx: DBAccessContext) =
    updateBooleanCol(id, _.paused, isPaused)

}


object ProjectService extends LazyLogging with FoxImplicits {

  def deleteOne(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[Boolean] = {
    val futureFox: Future[Fox[Boolean]] = for {
      removalSuccessBox <- ProjectSQLDAO.deleteOne(projectId).futureBox
    } yield {
      removalSuccessBox match {
        case Full(_) => {
          for {
            _ <- TaskSQLDAO.removeAllWithProjectAndItsAnnotations(projectId)
          } yield true
        }
        case _ => {
          logger.warn("Tried to remove project without permission.")
          Fox.successful(false)
        }
      }
    }
    futureFox.toFox.flatten
  }

}
