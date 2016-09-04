package models.task

import scala.async.Async._
import scala.concurrent.Future

import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.util.mvc.Formatter
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation._
import models.basics._
import models.mturk.{MTurkAssignmentConfig, MTurkAssignmentDAO}
import models.project.{Project, ProjectDAO, WebknossosAssignmentConfig}
import models.user.{Experience, User}
import org.joda.time.DateTime
import org.joda.time.format.DateTimeFormat
import oxalis.mturk.MTurkService
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsNull, JsObject, Json}
import reactivemongo.play.json.BSONFormats._
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID

class info(message: String) extends scala.annotation.StaticAnnotation

case class Task(
  @info("Reference to task type") _taskType: BSONObjectID,
  @info("Assigned name") team: String,
  @info("Required experience") neededExperience: Experience = Experience.empty,
  @info("Number of required instances") instances: Int = 1,
  @info("Current tracing time") tracingTime: Option[Long] = None,
  @info("Date of creation") created: DateTime = DateTime.now(),
  @info("Flag indicating deletion") isActive: Boolean = true,
  @info("Reference to project") _project: String,
  @info("Unique ID") _id: BSONObjectID = BSONObjectID.generate
) extends FoxImplicits {

  lazy val id = _id.stringify

  def taskType(implicit ctx: DBAccessContext) = TaskTypeDAO.findOneById(_taskType)(GlobalAccessContext).toFox

  def project(implicit ctx: DBAccessContext) =
    ProjectDAO.findOneByName(_project)

  def annotations(implicit ctx: DBAccessContext) =
    AnnotationService.annotationsFor(this)

  def settings(implicit ctx: DBAccessContext) =
    taskType.map(_.settings) getOrElse AnnotationSettings.skeletonDefault

  def annotationBase(implicit ctx: DBAccessContext) =
    AnnotationService.baseFor(this)

  def remainingInstances(implicit ctx: DBAccessContext) = {
    def calculateRemaining(project: Project) = {
      project.assignmentConfiguration match {
        case WebknossosAssignmentConfig =>
          OpenAssignmentDAO.countFor(_id)
        case _: MTurkAssignmentConfig   =>
          MTurkAssignmentDAO.findOneByTask(_id).map(_.numberOfOpenAssignments)
      }
    }

    for {
      p <- project
      result <- calculateRemaining(p)
    } yield result
  }

  def inProgress(implicit ctx: DBAccessContext) = {
    def calculateInProgress(project: Project) = {
      project.assignmentConfiguration match {
        case WebknossosAssignmentConfig =>
          AnnotationService.countUnfinishedAnnotationsFor(this)
        case _: MTurkAssignmentConfig   =>
          MTurkAssignmentDAO.findOneByTask(_id).map(_.numberOfInProgressAssignments)
      }
    }

    for {
      p <- project
      result <- calculateInProgress(p)
    } yield result
  }

  def status(implicit ctx: DBAccessContext) = {
    for {
      inProgress <- inProgress.getOrElse(0)
      remaining <- remainingInstances.getOrElse(0)
    } yield CompletionStatus(
        open = remaining,
        inProgress = inProgress,
        completed = instances - (inProgress + remaining))
  }

  def hasEnoughExperience(user: User) = {
    neededExperience.isEmpty || user.experiences.get(neededExperience.domain).exists(_ >= neededExperience.value)
  }
}

object Task extends FoxImplicits {
  implicit val taskFormat = Json.format[Task]

  def transformToJson(task: Task, forUser: Option[User])(implicit ctx: DBAccessContext): Future[JsObject] = {
    for {
      annotationContent <- task.annotationBase.flatMap(_.content).futureBox
      dataSetName = annotationContent.map(_.dataSetName).openOr("")
      editPosition = annotationContent.map(_.editPosition).openOr(Point3D(0, 0, 0))
      editRotation = annotationContent.map(_.editRotation).openOr(Vector3D(0, 0, 0))
      boundingBox = annotationContent.flatMap(_.boundingBox).toOption
      status <- task.status.getOrElse(CompletionStatus(-1, -1, -1))
      tt <- task.taskType.map(TaskType.transformToJson) getOrElse JsNull
    } yield {
      Json.obj(
        "id" -> task.id,
        "team" -> task.team,
        "formattedHash" -> Formatter.formatHash(task.id),
        "projectName" -> task._project,
        "type" -> tt,
        "dataSet" -> dataSetName,
        "editPosition" -> editPosition,
        "editRotation" -> editRotation,
        "boundingBox" -> boundingBox,
        "neededExperience" -> task.neededExperience,
        "created" -> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(task.created),
        "status" -> status,
        "tracingTime" -> task.tracingTime
      )
    }
  }
}

object TaskDAO extends SecuredBaseDAO[Task] with FoxImplicits with QuerySupportedDAO[Task] {

  val collectionName = "tasks"

  val formatter = Task.taskFormat

  underlying.indexesManager.ensure(Index(Seq("_project" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("team" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_taskType" -> IndexType.Ascending)))

  override val AccessDefinitions = new DefaultAccessDefinitions {

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamNames)))
        case _                =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.adminTeamNames)))
        case _                =>
          DenyEveryone()
      }
    }
  }

  override def find(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    super.find(query ++ Json.obj("isActive" -> true))
  }

  override def findOne(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    super.findOne(query ++ Json.obj("isActive" -> true))
  }

  def findAllAdministratable(user: User, limit: Int)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(Json.obj(
      "team" -> Json.obj("$in" -> user.adminTeamNames))).cursor[Task]().collect[List](maxDocs = limit)
  }

  def removeAllWithProject(project: Project)(implicit ctx: DBAccessContext) = {
    project.tasks.map(_.map(task => {
      removeById(task._id)
    }))
  }

  def findAllByTaskType(_taskType: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find("_taskType", _taskType).collect[List]()
  }

  def findAllByProject(project: String)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find("_project", project).collect[List]()
  }

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _task), Json.obj("$inc" -> Json.obj("tracingTime" -> time)))

  def update(_task: BSONObjectID, _taskType: BSONObjectID,
    neededExperience: Experience,
    instances: Int,
    team: String,
    _project: Option[String]
  )(implicit ctx: DBAccessContext): Fox[Task] =
    findAndModify(
      Json.obj("_id" -> _task),
      Json.obj("$set" ->
        Json.obj(
          "neededExperience" -> neededExperience,
          "instances" -> instances,
          "team" -> team,
          "_project" -> _project)),
      returnNew = true)

  def executeUserQuery(q: JsObject, limit: Int)(implicit ctx: DBAccessContext): Fox[List[Task]] = withExceptionCatcher {
    // Can't use local find, since it appends `isActive = true` to the query!
    super.find(q).cursor[Task]().collect[List](maxDocs = limit)
  }
}

