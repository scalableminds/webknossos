package models.task

import models.basics._
import java.util.Date
import braingames.geometry.Point3D
import org.bson.types.ObjectId
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import play.api.Logger
import models.user.{User, Experience}
import models.annotation.{AnnotationService, AnnotationType, AnnotationDAO, AnnotationSettings}
import play.api.libs.json.{Json, JsObject}
import braingames.format.Formatter
import scala.concurrent.duration._
import braingames.util.FoxImplicits
import braingames.reactivemongo.{GlobalAccessContext, DBAccessContext}
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._

case class Task(
                 seedIdHeidelberg: Int,
                 _taskType: BSONObjectID,
                 neededExperience: Experience = Experience.empty,
                 priority: Int = 100,
                 instances: Int = 1,
                 assignedInstances: Int = 0,
                 tracingTime: Option[Long] = None,
                 created: Long = System.currentTimeMillis,
                 _project: Option[String] = None,
                 training: Option[Training] = None,
                 _id: BSONObjectID = BSONObjectID.generate
               ) extends FoxImplicits {

  lazy val id = _id.stringify

  def taskType = TaskTypeDAO.findOneById(BSONObjectID.apply(_taskType.toString))(GlobalAccessContext).toFox

  def project = _project.toFox.flatMap(name => ProjectDAO.findOneByName(name)(GlobalAccessContext))

  def annotations =
    AnnotationDAO.findByTaskIdAndType(new ObjectId(_id.stringify), AnnotationType.Task)

  def isFullyAssigned = instances <= assignedInstances

  def settings = taskType.map(_.settings) getOrElse AnnotationSettings.default

  def isTraining = training.isDefined

  def annotationBase = AnnotationDAO.findByTaskIdAndType(new ObjectId(_id.stringify), AnnotationType.TracingBase).headOption

  def unassigneOnce = this.copy(assignedInstances = assignedInstances - 1)

  def status = {
    val inProgress = annotations.filter(!_.state.isFinished).size
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

  def transformToJson(task: Task): Future[JsObject] = {
    for {
      dataSetName <- task.annotationBase.toFox.flatMap(_.dataSetName) getOrElse ""
      editPosition <- task.annotationBase.toFox.flatMap(_.content.map(_.editPosition)) getOrElse Point3D(1, 1, 1)
    } yield {
      Json.obj(
        "id" -> task.id,
        "formattedHash" -> Formatter.formatHash(task.id),
        "seedIdHeidelberg" -> task.seedIdHeidelberg,
        "projectName" -> task._project.getOrElse("").toString,
        "type" -> task.taskType.map(_.summary).getOrElse("<deleted>").toString,
        "dataSet" -> dataSetName,
        "editPosition" -> editPosition,
        "neededExperience" -> task.neededExperience,
        "priority" -> task.priority,
        "created" -> Formatter.formatDate(task.created),
        "status" -> task.status
      )
    }
  }
}

object TaskDAO extends SecuredBaseDAO[Task] with FoxImplicits {

  val collectionName = "tasks"

  val formatter = Task.taskFormat

  // TODO: ensure index!
  // this.collection.ensureIndex("_project")
  // this.collection.ensureIndex("_taskType")

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
             _project: Option[String]
            )(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj("_id" -> _task),
      Json.obj("$set" ->
        Json.obj(
          "neededExperience" -> neededExperience,
          "priority" -> priority,
          "instances" -> instances,
          "_project" -> _project)))
}