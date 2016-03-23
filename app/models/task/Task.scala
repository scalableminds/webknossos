package models.task

import models.basics._
import java.util.Date
import com.scalableminds.util.geometry.{Point3D, Vector3D}

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import models.user.{User, Experience}
import models.annotation._
import play.api.libs.json.{JsNull, Json, JsObject}
import com.scalableminds.util.mvc.Formatter
import scala.concurrent.duration._
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.reactivemongo.{DefaultAccessDefinitions, GlobalAccessContext, DBAccessContext}
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import org.joda.time.DateTime
import org.joda.time.format.DateTimeFormat
import java.text.SimpleDateFormat
import scala.async.Async._
import reactivemongo.api.indexes.{IndexType, Index}
import reactivemongo.core.commands.LastError
import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}

case class Task(
                 _taskType: BSONObjectID,
                 team: String,
                 neededExperience: Experience = Experience.empty,
                 priority: Int = 100,
                 instances: Int = 1,
                 tracingTime: Option[Long] = None,
                 created: DateTime = DateTime.now(),
                 directLinks: List[String] = Nil,
                 isActive: Boolean = true,
                 _project: Option[String] = None,
                 _id: BSONObjectID = BSONObjectID.generate
               ) extends FoxImplicits {

  lazy val id = _id.stringify

  def taskType(implicit ctx: DBAccessContext) = TaskTypeDAO.findOneById(_taskType)(GlobalAccessContext).toFox

  def project(implicit ctx: DBAccessContext) =
    _project.toFox.flatMap(name => ProjectDAO.findOneByName(name))

  def annotations(implicit ctx: DBAccessContext) =
    AnnotationService.annotationsFor(this)

  def settings(implicit ctx: DBAccessContext) =
    taskType.map(_.settings) getOrElse AnnotationSettings.skeletonDefault

  def annotationBase(implicit ctx: DBAccessContext) =
    AnnotationService.baseFor(this)

  def remainingInstances(implicit ctx: DBAccessContext) =
    OpenAssignmentDAO.countFor(_id)

  def status(implicit ctx: DBAccessContext) = async{
    val inProgress = await(AnnotationService.countUnfinishedAnnotationsFor(this) getOrElse 0)
    val remaining = await(remainingInstances getOrElse 0)
    CompletionStatus(
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

  def transformToJson(task: Task)(implicit ctx: DBAccessContext): Future[JsObject] = {
    for {
      annotationContent <- task.annotationBase.flatMap(_.content).futureBox
      dataSetName = annotationContent.map(_.dataSetName).openOr("")
      editPosition = annotationContent.map(_.editPosition).openOr(Point3D(0, 0, 0))
      editRotation = annotationContent.map(_.editRotation).openOr(Vector3D(0, 0, 0))
      boundingBox = annotationContent.flatMap(_.boundingBox).toOption
      status <- task.status
      tt <- task.taskType.map(TaskType.transformToJson) getOrElse JsNull
      projectName = task._project.getOrElse("")
    } yield {
      Json.obj(
        "id" -> task.id,
        "team" -> task.team,
        "formattedHash" -> Formatter.formatHash(task.id),
        "projectName" -> projectName,
        "type" -> tt,
        "dataSet" -> dataSetName,
        "editPosition" -> editPosition,
        "editRotation" -> editRotation,
        "isForAnonymous" -> !task.directLinks.isEmpty,
        "boundingBox" -> boundingBox,
        "neededExperience" -> task.neededExperience,
        "priority" -> task.priority,
        "directLinks" -> task.directLinks,
        "created" -> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(task.created),
        "status" -> status,
        "tracingTime" -> task.tracingTime
      )
    }
  }
}

object TaskDAO extends SecuredBaseDAO[Task] with FoxImplicits {

  val collectionName = "tasks"

  val formatter = Task.taskFormat

  underlying.indexesManager.ensure(Index(Seq("_project" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("team" -> IndexType.Ascending)))
  underlying.indexesManager.ensure(Index(Seq("_taskType" -> IndexType.Ascending)))

  override val AccessDefinitions = new DefaultAccessDefinitions{

    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.teamNames)))
        case _ =>
          DenyEveryone()
      }
    }

    override def removeQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match{
        case Some(user: User) =>
          AllowIf(Json.obj("team" -> Json.obj("$in" -> user.adminTeamNames)))
        case _ =>
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

  def findAllAdministratable(user: User)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj(
      "team" -> Json.obj("$in" -> user.adminTeamNames))).cursor[Task].collect[List]()
  }

  def removeAllWithProject(project: Project)(implicit ctx: DBAccessContext) = {
    project.tasks.map(_.map(task => {
      removeById(task._id)
    }))
  }

  def findAllByTaskType(_taskType: BSONObjectID)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find("_taskType", _taskType).collect[List]()
  }

  def findAllByProject(project: String)(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find("_project", project).collect[List]()
  }

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    update(Json.obj("_id" -> _task), Json.obj("$inc" -> Json.obj("tracingTime" -> time)))

  def update(_task: BSONObjectID, _taskType: BSONObjectID,
             neededExperience: Experience,
             priority: Int,
             instances: Int,
             team: String,
             _project: Option[String]
            )(implicit ctx: DBAccessContext): Fox[Task] =
    findAndModify(
      Json.obj("_id" -> _task),
      Json.obj("$set" ->
        Json.obj(
          "neededExperience" -> neededExperience,
          "priority" -> priority,
          "instances" -> instances,
          "team" -> team,
          "_project" -> _project)),
    returnNew = true)
}
