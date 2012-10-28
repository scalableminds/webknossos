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

case class Task(
    taskID: Int, 
    zellId: Int, 
    start: Point3D, 
    priority: Int, 
    created: Date, 
    experiment: Option[Experiment],
    completedBy: Option[ObjectId],
    _id: ObjectId = new ObjectId) {
  def id = _id.toString
}

object Task extends BasicDAO[Task]("tasks"){
  val jsExecutionActor = Akka.system.actorOf( Props[JsExecutionActor] )
  val conf = current.configuration
  implicit val timeout = Timeout( ( conf.getInt( "js.defaultTimeout" ) getOrElse 5 ) seconds ) // needed for `?` below
  
  
  def nextTaskIdForUser(user: User): Future[Int] = {
    val params = Map( "user" -> user, "tasks" -> Task.findAll.toArray)
    
    val future = ( jsExecutionActor ? JS( TaskSelectionAlgorithm.current.js, params ) ) recover {
      case e: AskTimeoutException =>
        ""
    }
    future.mapTo[Int]
  }
}