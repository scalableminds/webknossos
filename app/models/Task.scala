package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import java.util.Date
import brainflight.tools.geometry.Point3D
import models.graph.Experiment
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

case class Task(
    taskId: Int,
    zellId: Int,
    start: Point3D,
    priority: Int,
    created: Date,
    experiment: Option[Experiment],
    completedBy: Option[ObjectId],
    _id: ObjectId = new ObjectId) {
  def id = _id.toString
}

object Task extends BasicDAO[Task]("tasks") {
  val jsExecutionActor = Akka.system.actorOf(Props[JsExecutionActor])
  val conf = current.configuration
  implicit val timeout = Timeout((conf.getInt("js.defaultTimeout") getOrElse 5) seconds) // needed for `?` below

  def nextTaskIdForUser(user: User): Future[Option[Int]] = {
    val tasks = Task.findAll.toArray
    if (tasks.isEmpty) {
      Promise.successful( None )( Akka.system.dispatcher)
    } else {
      val params = Map("user" -> user, "tasks" -> tasks)

      val future = (jsExecutionActor ? JS(TaskSelectionAlgorithm.current.js, params)) recover {
        case e: AskTimeoutException =>
          ""
      }
      future.mapTo[Int].map(x => Some(x) )
    }
  }
  
  implicit object TaskFormat extends Format[Task] {
    val TASK_ID = "taskId"
    val ZELL_ID = "zellId"
    val START = "start"
    val PRIORITY = "priority"
    val CREATED = "created"

    def writes(e: Task) = Json.obj(
      TASK_ID -> e.taskId,
      ZELL_ID -> e.zellId,
      START -> e.start,
      PRIORITY -> e.priority)  }
}