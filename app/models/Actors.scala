package models

import akka.actor._
import play.api.libs.concurrent._
import play.api.Play.current
import brainflight.mail.Mailer
import brainflight.binary.DataSetActor
import akka.routing.RoundRobinRouter

object Actors {
  val NumOfCPUCores = 8

  val Mailer = Akka.system.actorOf( Props[Mailer] )
  val DataSetActor = Akka.system.actorOf( Props[DataSetActor].withRouter(
    RoundRobinRouter( nrOfInstances = NumOfCPUCores ) ) )
}