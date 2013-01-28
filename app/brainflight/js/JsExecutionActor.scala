package brainflight.js

import akka.actor.Actor
import brainflight.tools.geometry.Point3D
import models.binary.DataSet
import scala.collection.mutable.ArrayBuffer
import akka.agent.Agent
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.ActorRef

case class JS(fktBody: String, params: Map[String, Any])

class JsExecutionActor extends Actor {
  val jsExecutor = new JsExecutor
  def receive = {
    case JS(fktBody, params) =>
      sender ! jsExecutor.execute(fktBody, params)
  }
} 
