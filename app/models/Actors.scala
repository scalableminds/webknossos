package models

import akka.actor._
import play.api.libs.concurrent._
import play.api.Play.current
import brainflight.mail.Mailer
import brainflight.binary.DataSetActor
import akka.routing.RoundRobinRouter
import brainflight.binary._

object Actors {
  val NumOfCPUCores = 8
  val system = Akka.system

  val Mailer = system.actorOf( Props[Mailer], name = "mailActor" )
  val DataSetActor = system.actorOf( Props[DataSetActor].withDispatcher("dataset-prio-dispatcher").withRouter(
    RoundRobinRouter( nrOfInstances = NumOfCPUCores ) ) )
}