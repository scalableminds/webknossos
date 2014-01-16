package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics._
import java.util.Date
import braingames.geometry.Point3D
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.Props
import akka.pattern.ask
import braingames.js.JsExecutionActor
import braingames.js.JS
import akka.util.Timeout
import scala.concurrent.duration._
import akka.pattern.AskTimeoutException
import org.bson.types.ObjectId
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import models.user.User
import play.api.Logger
import models.user.Experience
import models.tracing._
import oxalis.nml.Tree
import scala.util._
import models.user.Domain
import models.annotation.{AnnotationType, AnnotationDAO, AnnotationSettings}
import play.api.libs.json.{Json, JsObject}
import braingames.format.Formatter

case class CompletionStatus(open: Int, inProgress: Int, completed: Int)

object CompletionStatus {
  implicit val completionStatusFormat = Json.format[CompletionStatus]
}

case class Task(
  seedIdHeidelberg: Int,
  _taskType: ObjectId,
  neededExperience: Experience = Experience.empty,
  priority: Int = 100,
  instances: Int = 1,
  assignedInstances: Int = 0,
  tracingTime: Option[Long] = None,
  created: Date = new Date,
  _project: Option[String] = None,
  training: Option[Training] = None,
  _id: ObjectId = new ObjectId) extends DAOCaseClass[Task] {

  val dao = Task

  lazy val id = _id.toString

  def taskType = TaskType.findOneById(_taskType)

  def project = _project.flatMap(name => Project.findOneByName(name))

  def annotations =
    AnnotationDAO.findByTaskIdAndType(_id, AnnotationType.Task)

  def isFullyAssigned = instances <= assignedInstances

  def settings = taskType.map(_.settings) getOrElse AnnotationSettings.default

  def isTraining = training.isDefined

  def annotationBase = AnnotationDAO.findByTaskIdAndType(_id, AnnotationType.TracingBase).headOption

  def assigneOnce = this.copy(assignedInstances = assignedInstances + 1)

  def unassigneOnce = this.copy(assignedInstances = assignedInstances - 1)

  def status = {
    val inProgress = annotations.filter(!_.state.isFinished).size
    CompletionStatus(
      open = instances - assignedInstances,
      inProgress = inProgress,
      completed = assignedInstances - inProgress)
  }
}

object Task extends BasicDAO[Task]("tasks") {
  this.collection.ensureIndex("_project")
  this.collection.ensureIndex("_taskType")

  val jsExecutionActor = Akka.system.actorOf(Props[JsExecutionActor])
  val conf = current.configuration

  implicit val taskFormat = Json.format[Task]
  
  implicit val timeout = Timeout((conf.getInt("js.defaultTimeout") getOrElse 5) seconds) // needed for `?` below

  override def removeById(t: ObjectId, wc: com.mongodb.WriteConcern = defaultWriteConcern) = {
    AnnotationDAO.removeAllWithTaskId(t)
    super.removeById(t, wc)
  }

  def transformToJson(task: Task) : JsObject = {
   Json.obj (
      "id" -> task.id,
      "formattedHash" -> Formatter.formatHash(task.id),
      "seedIdHeidelberg" -> task.seedIdHeidelberg,
      "projectName" -> task._project.getOrElse("").toString,
      "type" -> task.taskType.map(_.summary).getOrElse("<deleted>").toString ,
      "dataSet" -> task.annotationBase.map(_.dataSetName),
      "editPosition" -> task.annotationBase.flatMap(_.content.map(_.editPosition)),
      "neededExperience" -> task.neededExperience,
      "priority" -> task.priority,
      "created" -> Formatter.formatDate(task.created),
      "status" -> task.status
    )
  }

  override def insertOne(task: Task) = {
    Domain.findOrCreate(task.neededExperience.domain)
    super.insertOne(task)
  }

  def findAllOfOneType(isTraining: Boolean) =
    find(MongoDBObject("training" -> MongoDBObject("$exists" -> isTraining)))
      .toList

  def findAllByTaskType(taskType: TaskType) =
    find(MongoDBObject("_taskType" -> taskType._id))
      .toList

  def findAllByProject(project: String) =
    find(MongoDBObject("_project" -> project))
      .toList

  def findAllTrainings =
    findAllOfOneType(isTraining = true)

  def findAllNonTrainings =
    findAllOfOneType(isTraining = false)

  def findAllAssignableNonTrainings = {
    findAllNonTrainings.filter(!_.isFullyAssigned)
  }

  def findAssignableTasksFor(user: User) = {
    findAssignableFor(user, shouldBeTraining = false)
  }

  def logTime(time: Long, task: Task) = {
    update(MongoDBObject("_id" -> task._id), MongoDBObject("$inc" -> MongoDBObject("tracingTime" -> time)))
  }

  def findAssignableFor(user: User, shouldBeTraining: Boolean) = {
    val finishedTasks = AnnotationDAO.findFor(user, AnnotationType.Task).flatMap(_._task)
    val availableTasks =
      if (shouldBeTraining)
        findAllTrainings
      else
        findAllAssignableNonTrainings

    availableTasks.filter(t =>
      !finishedTasks.contains(t._id) && hasEnoughExperience(user, t))
  }

  def copyDeepAndInsert(source: Task, includeUserTracings: Boolean = true) = {
    val task = insertOne(source.copy(_id = new ObjectId))
    AnnotationDAO
      .findByTaskId(source._id)
      .foreach {
      annotation =>
        if (includeUserTracings || AnnotationType.isSystemTracing(annotation)) {
          println("Copying: " + annotation.id)
          AnnotationDAO.copyDeepAndInsert(annotation.copy(_task = Some(task._id)))
        }
    }
    task
  }

  def toTrainingForm(t: Task): Option[(String, Training)] =
    Some((t.id, (t.training getOrElse Training.empty)))

  def fromTrainingForm(taskId: String, training: Training) =
    Task.findOneById(taskId) map {
      _.copy(training = Some(training))
    } getOrElse null

  def hasEnoughExperience(user: User, task: Task) = {
    if (task.neededExperience.isEmpty) {
      true
    } else {
      user.experiences
        .get(task.neededExperience.domain)
        .map(_ >= task.neededExperience.value)
        .getOrElse(false)
    }
  }

  def nextTaskForUser(user: User): Future[Option[Task]] = {
    nextTaskForUser(
      user,
      findAssignableTasksFor(user).toArray)
  }

  private def nextTaskForUser(user: User, tasks: Array[Task]): Future[Option[Task]] = {
    if (tasks.isEmpty) {
      Future.successful(None)
    } else {
      val params = Map("user" -> user, "tasks" -> tasks)

      (jsExecutionActor ? JS(TaskSelectionAlgorithm.current.js, params))
        .mapTo[Future[Try[Task]]].flatMap(_.map {
        case Failure(f) =>
          Logger.error("JS Execution error: " + f)
          None
        case Success(s) =>
          Some(s)
      })
        .recover {
        case e: AskTimeoutException =>
          Logger.warn("JS Execution actor didn't return in time!")
          None
        case e: Exception =>
          Logger.error("JS Execution catched exception: " + e.toString())
          e.printStackTrace()
          None
      }
    }
  }

  def simulateFinishOfCurrentTask(user: User) = {
    (for {
      annotation <- AnnotationDAO.findOpenAnnotationFor(user, AnnotationType.Task)
      task <- annotation.task
      if (task.isTraining)
      training <- task.training
    } yield {
      user.increaseExperience(training.domain, training.gain)
    }) getOrElse user
  }

  def simulateTaskAssignment(users: List[User]) = {
    val preparedUsers = users.map(simulateFinishOfCurrentTask)
    def f(users: List[User], tasks: Map[ObjectId, Task], result: Map[User, Task]): Future[Map[User, Task]] = {
      users match {
        case user :: tail =>
          simulateTaskAssignments(user, tasks).flatMap {
            case Some((task, alertedtasks)) =>
              f(tail, alertedtasks, result + (user -> task))
            case _ =>
              f(tail, tasks, result)
          }
        case _ =>
          Future.successful(result)
      }
    }
    val nonTrainings = findAllAssignableNonTrainings.map(t => t._id -> t).toMap
    f(preparedUsers, nonTrainings, Map.empty)
  }

  def simulateTaskAssignments(user: User, tasks: Map[ObjectId, Task]) = {
    val doneTasks = AnnotationDAO.findFor(user, AnnotationType.Task).flatMap(_._task)
    val tasksAvailable = tasks.values.filter(t =>
      hasEnoughExperience(user, t) && !doneTasks.contains(t._id) && !t.isFullyAssigned)
    nextTaskForUser(user, tasksAvailable.toArray).map {
      case Some(task) =>
        Some(task -> (tasks + (task._id -> task.copy(assignedInstances = task.assignedInstances + 1))))
      case _ =>
        Training.findAssignableFor(user).headOption.map {
          training =>
            training -> tasks
        }
    }
  }
}