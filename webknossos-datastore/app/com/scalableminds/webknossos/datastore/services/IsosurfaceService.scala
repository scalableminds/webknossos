package com.scalableminds.webknossos.datastore.services

import akka.actor.{Actor, ActorSystem, Props}
import akka.pattern.{AskTimeoutException, ask}
import akka.routing.RoundRobinPool
import akka.util.Timeout
import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Failure, Full}

import scala.concurrent.duration._
import scala.concurrent.{ExecutionContext, Future}

class IsosurfaceService @Inject()(actorSystem: ActorSystem)(implicit ec: ExecutionContext) extends FoxImplicits {

  val actor = actorSystem.actorOf(RoundRobinPool(1).props(Props[IsosurfaceActor]))

  def requestIsosurface(segmentId: Long): Fox[String] = {
    implicit val timeout = Timeout(30 seconds)
    actor.ask(segmentId).mapTo[Box[String]].recover {
      case e: AskTimeoutException => Failure("timeout")
    }
  }
}

class IsosurfaceActor extends Actor {
  def receive = {
    case 1230341 => {
      println("starting")
      Thread.sleep(10000)
      sender ! Full("hello back at you")
      println("done")
    }
    case _ =>
      sender ! Failure("error in actor")
  }
}
