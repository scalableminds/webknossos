package brainflight.binary

import akka.actor.Actor
import brainflight.tools.geometry.Point3D
import models.binary._
import scala.collection.mutable.ArrayBuffer
import akka.agent.Agent
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.ActorRef
import akka.actor.ActorSystem
import brainflight.tools.geometry.Vector3D

case class SingleRequest( dataRequest: DataRequest )
case class MultiCubeRequest( requests: Array[SingleRequest] )

class DataSetActor extends Actor {
  implicit val system = ActorSystem("agents")

  val BinaryCacheAgent = Agent( Map[DataBlockInformation, Data]().empty )
  val dataStore = new FileDataStore(BinaryCacheAgent )
  
  def receive = {
    case SingleRequest( dataRequest ) =>
      sender ! dataStore.load( dataRequest )
    case MultiCubeRequest( requests ) =>
      val results = requests.map( r =>
        dataStore.load( r.dataRequest ))
      sender ! Array.concat( results: _*)
  }
} 
