package brainflight.binary

import akka.actor.Actor
import brainflight.tools.geometry.Point3D
import models.binary._
import brainflight.tools.geometry.Cuboid
import scala.collection.mutable.ArrayBuffer
import akka.agent.Agent
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.ActorRef
import akka.actor.ActorSystem
import brainflight.tools.geometry.Vector3D
//TODO: rename points to cube

case class SingleRequest( dataSet: DataSet, dataLayer: DataLayer, resolution: Int, point: Point3D )
case class MultiCubeRequest( requests: Array[CubeRequest] )
case class ArbitraryRequest(dataSet: DataSet, dataLayer: DataLayer, resolution: Int, points: Array[Vector3D])
case class CubeRequest( dataSet: DataSet, dataLayer: DataLayer, resolution: Int, points: Cuboid, halfByte: Boolean)

class DataSetActor extends Actor {
  implicit val system = ActorSystem("agents")

  val BinaryCacheAgent = Agent( Map[DataBlockInformation, Data]().empty )
  val dataStore = new FileDataStore(BinaryCacheAgent )
  
  def receive = {
     case ArbitraryRequest( dataSet, dataLayer, resolution, points ) =>
      sender ! dataStore.loadInterpolated( dataSet, dataLayer, resolution, points )
    case SingleRequest( dataSet, dataLayer, resolution, point ) =>
      sender ! dataStore.load( dataSet, dataLayer, resolution, point )
    case CubeRequest( dataSet, dataLayer, resolution, points, halfByte ) =>
      sender ! dataStore.load( dataSet, dataLayer, resolution, points, halfByte )
    case MultiCubeRequest( requests ) =>
      val results = requests.map( r =>
        dataStore.load( r.dataSet, r.dataLayer, r.resolution, r.points, r.halfByte))
      sender ! Array.concat( results: _*)
  }
} 
