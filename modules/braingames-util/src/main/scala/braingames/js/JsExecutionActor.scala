package braingames.js

import akka.actor.Actor

case class JS(fktBody: String, params: Map[String, Any])

class JsExecutionActor extends Actor {
  lazy val jsExecutor = new JsExecutor(context.system.scheduler)
  def receive = {
    case JS(fktBody, params) =>
      sender ! jsExecutor.execute(fktBody, params)
  }
} 
