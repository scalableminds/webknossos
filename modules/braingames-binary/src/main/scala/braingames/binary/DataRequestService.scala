package braingames.binary

import akka.actor.ActorSystem
import akka.actor.Props
import com.typesafe.config.ConfigFactory
import akka.agent.Agent
import scala.concurrent.Future
import akka.routing.RoundRobinRouter

trait DataRequestService {
  implicit def system: ActorSystem
  
  val config = ConfigFactory.load()
  
  val dataRequestActor = {
    val nrOfBinRequestActors = config.getInt("braingames.binary.nrOfBinRequestActors")
    val bindataCache = Agent[Map[LoadBlock, Future[Array[Byte]]]](Map.empty)
    system.actorOf(Props(new DataRequestActor(config.getConfig("braingames.binary"), bindataCache))
      .withRouter(new RoundRobinRouter(nrOfBinRequestActors)), "dataRequestActor")
  }
  
}