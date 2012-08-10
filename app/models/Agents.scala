package models

import akka.agent.Agent
import play.api.libs.concurrent.Akka
import play.api.Play.current
import brainflight.binary.DataBlockInformation
import brainflight.binary.Data
import akka.actor.ActorRef

object Agents {
  implicit val system = Akka.system

  val BinaryCacheAgent = Agent( Map[DataBlockInformation, Data]().empty )
}