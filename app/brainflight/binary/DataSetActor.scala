package brainflight.binary

import akka.actor.Actor
import brainflight.tools.geometry.Point3D
import models.binary._
import scala.collection.mutable.ArrayBuffer
import akka.agent.Agent
import play.api.Logger
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.ActorRef
import play.api.libs.concurrent.Promise
import play.api.libs.concurrent.execution.defaultContext
import akka.actor.ActorSystem
import brainflight.tools.geometry.Vector3D

case class SingleRequest(dataRequest: DataRequest)
case class MultiCubeRequest(requests: Array[SingleRequest])

class DataSetActor extends Actor {
  implicit val system = ActorSystem("agents")

  val BinaryCacheAgent = Agent(Map[DataBlockInformation, Data]().empty)
  val dataStores = List(new GridDataStore(BinaryCacheAgent),
      new FileDataStore(BinaryCacheAgent), new EmptyDataStore)

  def receive = {
    case SingleRequest(dataRequest) =>
      sender ! loadFromSomewhere(dataRequest)
    case MultiCubeRequest(requests) =>
      val resultsPromise = Promise.sequence(requests.map(r =>
        loadFromSomewhere(r.dataRequest)))
      sender ! resultsPromise.map { results =>
        val size = results.map(_.size).sum
        results.foldLeft(new ArrayBuffer[Byte](size))(_ ++= _)
      }
  }
  
  def loadFromSomewhere(dataRequest: DataRequest) = {
    def loadFromStore(dataStores: List[DataStore]): Promise[ArrayBuffer[Byte]] = dataStores match {
      case h :: tail =>
        h.load(dataRequest).recoverWith{
          case e: DataNotFoundException =>
            loadFromStore(tail)
        }
      case _ =>
        throw new DataNotFoundException
    }
    loadFromStore(dataStores)
  }
} 
