package models.task

import models.basics._
import java.util.Date
import braingames.geometry.Point3D

import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import models.user.{User, Experience}
import models.annotation._
import play.api.libs.json.{Json, JsObject}
import braingames.format.Formatter
import scala.concurrent.duration._
import braingames.util.FoxImplicits
import braingames.reactivemongo.{GlobalAccessContext, DBAccessContext}
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import org.joda.time.DateTime
import org.joda.time.format.DateTimeFormat
import java.text.SimpleDateFormat
import play.api.libs.json.JsObject
import scala.async.Async._
import akka.actor.Props
import akka.routing.RoundRobinRouter
import reactivemongo.api.indexes.{IndexType, Index}

case class Task(
                 seedIdHeidelberg: Int,
                 _taskType: BSONObjectID,
                 team: String,
                 neededExperience: Experience = Experience.empty,
                 priority: Int = 100,
                 instances: Int = 1,
                 assignedInstances: Int = 0,
                 tracingTime: Option[Long] = None,
                 created: DateTime = DateTime.now(),
                 _project: Option[String] = None,
                 training: Option[Training] = None,
                 _id: BSONObjectID = BSONObjectID.generate
               ) extends FoxImplicits {

  lazy val id = _id.stringify

  def taskType(implicit ctx: DBAccessContext) = TaskTypeDAO.findOneById(_taskType)(GlobalAccessContext).toFox

  def project(implicit ctx: DBAccessContext) =
    _project.toFox.flatMap(name => ProjectDAO.findOneByName(name))

  def isFullyAssigned =
    instances <= assignedInstances

  def annotations(implicit ctx: DBAccessContext) =
    AnnotationService.annotationsFor(this)

  def settings(implicit ctx: DBAccessContext) =
    taskType.map(_.settings) getOrElse AnnotationSettings.default

  def isTraining =
    training.isDefined

  def annotationBase(implicit ctx: DBAccessContext) =
    AnnotationService.baseFor(this)

  def unassigneOnce = this.copy(assignedInstances = assignedInstances - 1)

  def status(implicit ctx: DBAccessContext) = async{
    val inProgress = await(annotations).filter(!_.state.isFinished).size
    CompletionStatus(
      open = instances - assignedInstances,
      inProgress = inProgress,
      completed = assignedInstances - inProgress)
  }

  def hasEnoughExperience(user: User) = {
    if (this.neededExperience.isEmpty) {
      true
    } else {
      user.experiences
      .get(this.neededExperience.domain)
      .map(_ >= this.neededExperience.value)
      .getOrElse(false)
    }
  }
}

object Task extends FoxImplicits {
  implicit val taskFormat = Json.format[Task]

  def transformToJson(task: Task)(implicit ctx: DBAccessContext): Future[JsObject] = {
    for {
      dataSetName <- task.annotationBase.flatMap(_.dataSetName) getOrElse ""
      editPosition <- task.annotationBase.flatMap(_.content.map(_.editPosition)) getOrElse Point3D(1, 1, 1)
      status <- task.status
      taskType <- task.taskType.futureBox
      projectName = task._project.getOrElse("")
    } yield {
      Json.obj(
        "id" -> task.id,
        "team" -> task.team,
        "formattedHash" -> Formatter.formatHash(task.id),
        "seedIdHeidelberg" -> task.seedIdHeidelberg,
        "projectName" -> projectName,
        "type" -> taskType.toOption,
        "dataSet" -> dataSetName,
        "editPosition" -> editPosition,
        "neededExperience" -> task.neededExperience,
        "priority" -> task.priority,
        "created" -> DateTimeFormat.forPattern("yyyy-MM-dd HH:mm").print(task.created),
        "status" -> status,
        "isTraining" -> task.isTraining,
        "training" -> task.training
      )
    }
  }
}

object TaskDAO extends SecuredBaseDAO[Task] with FoxImplicits {

  val collectionName = "tasks"

  val formatter = Task.taskFormat

  collection.indexesManager.ensure(Index(Seq("_project" -> IndexType.Ascending)))
  collection.indexesManager.ensure(Index(Seq("_taskType" -> IndexType.Ascending)))

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



  @deprecated(message = "This mehtod shouldn't be used. Use TaskService.remove instead", "2.0")
  override def removeById(bson: BSONObjectID)(implicit ctx: DBAccessContext) = {
    super.removeById(bson)
  }

  def findAllOfOneType(isTraining: Boolean)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj("training" -> Json.obj("$exists" -> isTraining))).cursor[Task].collect[List]()

  def findAllByTaskType(taskType: TaskType)(implicit ctx: DBAccessContext) =
    find("_taskType", taskType._id).collect[List]()

  def findAllByProject(project: String)(implicit ctx: DBAccessContext) =
    find("_project", project).collect[List]()

  def findAllTrainings(implicit ctx: DBAccessContext) =
    findAllOfOneType(isTraining = true)

  def findAllNonTrainings(implicit ctx: DBAccessContext) =
    findAllOfOneType(isTraining = false)

  def findAllAssignableNonTrainings(implicit ctx: DBAccessContext) =
    findAllNonTrainings.map(_.filter(!_.isFullyAssigned))

  def logTime(time: Long, _task: BSONObjectID)(implicit ctx: DBAccessContext) =
    collectionUpdate(Json.obj("_id" -> _task), Json.obj("$inc" -> Json.obj("tracingTime" -> time)))

  def changeAssignedInstances(_task: BSONObjectID, by: Int)(implicit ctx: DBAccessContext) =
    collectionUpdate(Json.obj("_id" -> _task), Json.obj("$inc" -> Json.obj("assignedInstances" -> by)))

  def assignOnce(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    changeAssignedInstances(_task, 1)

  def unassignOnce(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    changeAssignedInstances(_task, -1)

  def setTraining(_task: BSONObjectID, training: Training)(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj("_id" -> _task),
      Json.obj("$set" -> Json.obj("training" -> training)))

  def update(_task: BSONObjectID, _taskType: BSONObjectID,
             neededExperience: Experience,
             priority: Int,
             instances: Int,
             team: String,
             _project: Option[String]
            )(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj("_id" -> _task),
      Json.obj("$set" ->
        Json.obj(
          "neededExperience" -> neededExperience,
          "priority" -> priority,
          "instances" -> instances,
          "team" -> team,
          "_project" -> _project)))
}