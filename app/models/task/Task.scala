package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import java.util.Date
import brainflight.tools.geometry.Point3D
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.Props
import akka.pattern.ask
import brainflight.js.JsExecutionActor
import brainflight.js.JS
import akka.util.Timeout
import akka.util.duration._
import akka.pattern.AskTimeoutException
import org.bson.types.ObjectId
import akka.dispatch.Future
import play.api.libs.concurrent.execution.defaultContext
import akka.dispatch.Promise
import play.api.libs.json.Format
import play.api.libs.json.Json
import play.api.libs.json.Writes
import models.graph.Tree
import brainflight.tools.geometry.Scale
import models.user.User
import play.api.Logger

case class Task(
    dataSetName: String,
    cellId: Int,
    seedIdHeidelberg: Int,
    _taskType: ObjectId,
    //requiredPermission: Int,
    start: Point3D,
    priority: Int = 100,
    instances: Int = 1,
    created: Date = new Date,
    _experiments: List[ObjectId] = Nil,
    _id: ObjectId = new ObjectId) {
  
  lazy val id = _id.toString

  def taskType = TaskType.findOneById(_taskType)
  
  def experiments = _experiments.map(Experiment.findOneById).flatten

  def isFullyAssigned = experiments.size == instances

  def inProgress =
    experiments.filter(!_.finished).size

  def completed =
    experiments.size - inProgress

  def open =
    instances - experiments.size
}

object Task extends BasicDAO[Task]("tasks") {
  val jsExecutionActor = Akka.system.actorOf(Props[JsExecutionActor])
  val conf = current.configuration

  val empty = Task("", 0, 0, null, Point3D(0, 0, 0))

  implicit val timeout = Timeout((conf.getInt("js.defaultTimeout") getOrElse 5) seconds) // needed for `?` below


  def createExperimentFor(user: User, task: Task) = {
    Experiment.alterAndInsert(Experiment(user._id,
      task.dataSetName,
      List(Tree.empty),
      Nil,
      0,
      1,
      Scale(12, 12, 24),
      task.start,
      Some(task._id)))
  }

  def findAllAssignable =
    findAll.filter(!_.isFullyAssigned)

  def addExperiment(task: Task, experiment: Experiment) = {
    alterAndSave(task.copy(
      _experiments = experiment._id :: task._experiments))
  }

  def toExperimentForm(t: Task): Option[(String, String, Int, Int)] = {
    Some(("", "", t.priority, t.instances))
  }
  
  def fromExperimentForm(experiment: String, taskTypeId: String, priority: Int, instances: Int): Task =
      (Experiment.findOneById(experiment), TaskType.findOneById(taskTypeId)) match {
      case (Some(e), Some(taskType)) =>
      Task(e.dataSetName,
          0,
          0,
          taskType._id,
          e.editPosition,
          priority,
          instances)
      case _ =>
      Logger.warn("Failed to create Task from form. Experiment: %s TaskType: %s".format(experiment, taskTypeId))
      null
  }
  
  def fromForm(dataSetName: String, taskTypeId: String, cellId: Int, start: Point3D, priority: Int, instances: Int): Task =
      TaskType.findOneById(taskTypeId) match {
      case Some(taskType) =>
      Task(dataSetName,
          cellId,
          0,
          taskType._id,
          start,
          priority,
          instances)
      case _ =>
        Logger.warn("Failed to create Task from form. TaskType: %s".format(taskTypeId))
        null
  }
  
  def toForm(t: Task): Option[(String, String, Int, Point3D, Int, Int)] = {
    Some((
        t.dataSetName, 
        t.taskType.map(_.id).getOrElse(""), 
        t.cellId,
        t.start,
        t.priority, 
        t.instances))
  }  
  
  def nextTaskForUser(user: User): Future[Option[Task]] = {
    val tasks = findAllAssignable.toArray
    if (tasks.isEmpty) {
      Promise.successful(None)(Akka.system.dispatcher)
    } else {
      val params = Map("user" -> user, "tasks" -> tasks)

      val future = (jsExecutionActor ? JS(TaskSelectionAlgorithm.current.js, params)) recover {
        case e: AskTimeoutException =>
          Logger.warn("JS Execution actor didn't return in time!")
          null
      }
      future.mapTo[Promise[Task]].flatMap(_.map { x =>
        Option(x)
      }).recover {
        case e: Exception =>
          Logger.error("Catched MAPTO exception: ")
          e.printStackTrace()
          None
      }
    }
  }

  implicit object TaskFormat extends Writes[Task] {
    val TASK_ID = "taskId"
    val CELL_ID = "cellId"
    val START = "start"
    val PRIORITY = "priority"
    val CREATED = "created"

    def writes(e: Task) = Json.obj(
      TASK_ID -> e.id,
      CELL_ID -> e.cellId,
      START -> e.start,
      PRIORITY -> e.priority)
  }
}