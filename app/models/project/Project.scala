package models.project

import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import com.typesafe.scalalogging.LazyLogging
import models.task.{TaskDAO, TaskService}
import models.team.TeamSQLDAO
import models.user.{User, UserService}
import net.liftweb.common.Full
import play.api.Play.current
import play.api.data.validation.ValidationError
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
    for {
      team <- TeamSQLDAO.findOneByName(p.team)
    } yield {
      ProjectSQL(
        ObjectId.fromBsonId(p._id),
        team._id,
        ObjectId.fromBsonId(p._owner),
        p.name,
        p.priority,
        p.paused,
        p.expectedTime.map(_.toLong),
        System.currentTimeMillis(),
        false)
    }
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

  // read operations

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[ProjectSQL] =
    for {
      rOpt <- run(Projects.filter(r => notdel(r) && r.name === name).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  // write operations

  def insertOne(p: ProjectSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.projects(_id, _team, _owner, name, priority, paused, expectedTime, created, isDeleted)
                         values(${p._id.id}, ${p._team.id}, ${p._owner.id}, ${p.name}, ${p.priority}, ${p.paused}, ${p.expectedTime}, ${new java.sql.Timestamp(p.created)}, ${p.isDeleted})""")
    } yield ()



  def updateOne(p: ProjectSQL)(implicit ctx: DBAccessContext): Fox[Unit] =
    for { //note that p.created is skipped
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

  def setPaused(id: ObjectId, isPaused: Boolean) =
    setBooleanCol(id, _.paused, isPaused)

}


case class Project(
                    name: String,
                    team: String,
                    _owner: BSONObjectID,
                    priority: Int,
                    paused: Boolean,
                    expectedTime: Option[Int],
                    _id: BSONObjectID = BSONObjectID.generate) {

  def owner = UserService.findOneById(_owner.stringify, useCache = true)(GlobalAccessContext)

  def isOwnedBy(user: User) = user._id == _owner

  def id = _id.stringify

  def tasks(implicit ctx: DBAccessContext) = TaskDAO.findAllByProject(name)(GlobalAccessContext)
}

object Project extends FoxImplicits {
  implicit val projectFormat = Json.format[Project]

  def StringObjectIdReads(key: String) =
    Reads.filter[String](ValidationError("objectid.invalid", key))(BSONObjectID.parse(_).isSuccess)

  def projectPublicWrites(project: Project, requestingUser: User): Future[JsObject] =
    for {
      owner <- project.owner.map(User.userCompactWrites.writes).futureBox
    } yield {
      Json.obj(
        "name" -> project.name,
        "team" -> project.team,
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
      (__ \ 'team).read[String] and
      (__ \ 'priority).read[Int] and
      (__ \ 'paused).readNullable[Boolean] and
      (__ \ 'expectedTime).readNullable[Int] and
      (__ \ 'owner).read[String](StringObjectIdReads("owner"))) (
      (name, team, priority, paused, expectedTime, owner) =>
        Project(name, team, BSONObjectID(owner), priority, paused getOrElse false, expectedTime))

  def fromProjectSQL(s: ProjectSQL)(implicit ctx: DBAccessContext): Fox[Project] = {
    for {
      team <- TeamSQLDAO.findOne(s._team) ?~> Messages("team.notFound")
      ownerBSON <- s._owner.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id)
      idBson <- s._id.toBSONObjectId.toFox ?~> Messages("sql.invalidBSONObjectId", s._id)
    } yield {
      Project(
        s.name,
        team.name,
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

  def update(_id: BSONObjectID, oldProject: Project, updateRequest: Project)(implicit ctx: DBAccessContext) = {
    def updateTasksIfNecessary(updated: Project) = {
      if (oldProject.priority == updated.priority)
        Fox.successful(true)
      else
        TaskService.handleProjectUpdate(updated)
    }

    for {
      updatedProject <- ProjectDAO.updateProject(_id, updateRequest)
      _ <- updateTasksIfNecessary(updatedProject)
    } yield updatedProject

  }

  def updatePauseStatus(project: Project, isPaused: Boolean)(implicit ctx: DBAccessContext) = {
    def updateTasksIfNecessary(updated: Project) = {
      if (updated.paused == project.paused)
        Fox.successful(true)
      else
        TaskService.handleProjectUpdate(updated)
    }

    val updated = project.copy(paused = isPaused)

    for {
      updatedProject <- ProjectDAO.updatePausedFlag(updated._id, updated.paused)
      _ <- updateTasksIfNecessary(updated)
    } yield updatedProject
  }
}

object ProjectDAO {

  /*
  override val AccessDefinitions = new DefaultAccessDefinitions {
    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamNames)))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("_owner" -> user._id))
        case _ =>
          DenyEveryone()
      }
    }
  }
*/

/*
  underlying.indexesManager.ensure(Index(Seq("name" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("team" -> IndexType.Ascending)))
  */

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

  def findAllByTeamNames(teamNames: List[String])(implicit ctx: DBAccessContext): Fox[List[Project]] = Fox.failure("not implemented")
  /* TODO Reports
  def findAllByTeamNames(teamNames: List[String])(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(Json.obj("team" -> Json.obj("$in" -> teamNames))).cursor[Project]().collect[List]()
  } */

  def updatePausedFlag(_id: BSONObjectID, isPaused: Boolean)(implicit ctx: DBAccessContext) =
    for {
      _ <- ProjectSQLDAO.setPaused(ObjectId.fromBsonId(_id), isPaused)
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
