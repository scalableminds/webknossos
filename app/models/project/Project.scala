package models.project

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext, JsonFormatHelper}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationState
import models.task.{TaskDAO, TaskService}
import models.team.{Team, TeamDAO, TeamSQLDAO}
import models.user.{User, UserService}
import net.liftweb.common.Full
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json.{Json, _}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
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
                     )

object ProjectSQL {
  def fromProject(p: Project)(implicit ctx: DBAccessContext) = {
    Fox.successful(ProjectSQL(
      ObjectId.fromBsonId(p._id),
      ObjectId.fromBsonId(p._team),
      ObjectId.fromBsonId(p._owner),
      p.name,
      p.priority,
      p.paused,
      p.expectedTime.map(_.toLong),
      System.currentTimeMillis(),
      false))
  }
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

  override def readAccessQ(requestingUserId: ObjectId) = s"(_team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}')) or _owner = '${requestingUserId.id}'"
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
      rList <- run(sql"select #${columns} from #${existingCollectionName} where name = ${name} and #${accessQuery}".as[ProjectsRow])
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
                         and a.state != '#${AnnotationState.Finished.toString}'
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


case class Project(
                    name: String,
                    _team: BSONObjectID,
                    _owner: BSONObjectID,
                    priority: Int,
                    paused: Boolean,
                    expectedTime: Option[Int],
                    _id: BSONObjectID = BSONObjectID.generate) {

  def owner = UserService.findOneById(_owner.stringify, useCache = true)(GlobalAccessContext)

  def isDeletableBy(user: User) = user._id == _owner || user.isAdmin

  def id = _id.stringify

  def tasks(implicit ctx: DBAccessContext) = TaskDAO.findAllByProject(name)(GlobalAccessContext)

  lazy val team = _team.stringify
}

object Project extends FoxImplicits {
  implicit val projectFormat = Json.format[Project]

  def projectPublicWrites(project: Project, requestingUser: User): Future[JsObject] =
    for {
      owner <- project.owner.map(User.userCompactWrites.writes).futureBox
      teamNameOption <- TeamDAO.findOneById(project._team)(GlobalAccessContext).map(_.name).toFutureOption
    } yield {
      Json.obj(
        "name" -> project.name,
        "team" -> project.team,
        "teamName" -> teamNameOption,
        "owner" -> owner.toOption,
        "priority" -> project.priority,
        "paused" -> project.paused,
        "expectedTime" -> project.expectedTime,
        "id" -> project.id
      )
    }

  def projectPublicWritesWithStatus(
                                     project: Project,
                                     openTaskInstances: Int,
                                     requestingUser: User)(implicit ctx: DBAccessContext): Future[JsObject] = {

    for {
      projectJson <- projectPublicWrites(project, requestingUser)
    } yield {
      projectJson + ("numberOfOpenAssignments" -> JsNumber(openTaskInstances))
    }
  }

  private val validateProjectName = Reads.pattern("^[a-zA-Z0-9_-]*$".r, "project.name.invalidChars")

  val projectPublicReads: Reads[Project] =
    ((__ \ 'name).read[String](Reads.minLength[String](3) keepAnd validateProjectName) and
      (__ \ 'team).read[String](JsonFormatHelper.StringObjectIdReads("team")) and
      (__ \ 'priority).read[Int] and
      (__ \ 'paused).readNullable[Boolean] and
      (__ \ 'expectedTime).readNullable[Int] and
      (__ \ 'owner).read[String](JsonFormatHelper.StringObjectIdReads("owner"))) (
      (name, team, priority, paused, expectedTime, owner) =>
        Project(name, BSONObjectID(team), BSONObjectID(owner), priority, paused getOrElse false, expectedTime))

  def fromProjectSQL(s: ProjectSQL)(implicit ctx: DBAccessContext): Fox[Project] = {
    for {
      team <- TeamSQLDAO.findOne(s._team)(GlobalAccessContext) ?~> Messages("team.notFound")
      ownerBSON <- s._owner.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id)
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id)
      teamIdBson <- team._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id.toString)
    } yield {
      Project(
        s.name,
        teamIdBson,
        ownerBSON,
        s.priority.toInt,
        s.paused,
        s.expectedTime.map(_.toInt),
        idBson
      )
    }
  }
}

object ProjectService extends FoxImplicits with LazyLogging {

  def remove(project: Project)(implicit ctx: DBAccessContext): Fox[Boolean] = {
    val futureFox: Future[Fox[Boolean]] = for {
      removalSuccessBox <- ProjectDAO.remove(project._id).futureBox
    } yield {
      removalSuccessBox match {
        case Full(_) => {
          for {
            _ <- TaskService.removeAllWithProject(project)
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

  def findIfNotEmpty(name: Option[String])(implicit ctx: DBAccessContext): Fox[Option[Project]] = {
    name match {
      case Some("") | None =>
        new Fox(Future.successful(Full(None)))
      case Some(x) =>
        ProjectDAO.findOneByName(x).toFox.map(p => Some(p))
    }
  }

  def update(_id: BSONObjectID, oldProject: Project, updateRequest: Project)(implicit ctx: DBAccessContext) =
    ProjectDAO.updateProject(_id, updateRequest)

  def updatePauseStatus(project: Project, isPaused: Boolean)(implicit ctx: DBAccessContext) =
    ProjectDAO.updatePausedFlag(project._id, isPaused)
}

object ProjectDAO {
  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    for {
      projectSQL <- ProjectSQLDAO.findOneByName(name)
      project <- Project.fromProjectSQL(projectSQL)
    } yield project

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[Project] =
    for {
      projectSQL <- ProjectSQLDAO.findOne(ObjectId(id))
      project <- Project.fromProjectSQL(projectSQL)
    } yield project

  def findOneById(id: BSONObjectID)(implicit ctx: DBAccessContext): Fox[Project] =
    findOneById(id.stringify)

  def updatePausedFlag(_id: BSONObjectID, isPaused: Boolean)(implicit ctx: DBAccessContext) =
    for {
      _ <- ProjectSQLDAO.updatePaused(ObjectId.fromBsonId(_id), isPaused)
      project <- findOneById(_id)
    } yield project

  def updateProject(_id: BSONObjectID, project: Project)(implicit ctx: DBAccessContext) =
    for {
      projectSQL <- ProjectSQL.fromProject(project.copy(_id = _id))
      _ <- ProjectSQLDAO.updateOne(projectSQL)
      updated <- findOneById(_id)
    } yield updated

  def insert(project: Project)(implicit ctx: DBAccessContext): Fox[Project] =
    for {
      projectSQL <- ProjectSQL.fromProject(project)
      _ <- ProjectSQLDAO.insertOne(projectSQL)
    } yield project

  def findAll(implicit ctx: DBAccessContext): Fox[List[Project]] =
    for {
      projectsSQL <- ProjectSQLDAO.findAll
      projects <- Fox.combined(projectsSQL.map(Project.fromProjectSQL(_)))
    } yield projects

  def remove(id: BSONObjectID)(implicit ctx: DBAccessContext) =
    ProjectSQLDAO.deleteOne(ObjectId.fromBsonId(id))
}
