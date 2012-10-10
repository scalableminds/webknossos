package brainflight.binary

import akka.actor.Actor
import brainflight.tools.geometry.Point3D
import models.DataSet
import brainflight.tools.geometry.Cuboid
import scala.collection.mutable.ArrayBuffer
import akka.agent.Agent
import play.api.libs.concurrent.Akka
import play.api.Play.current
import akka.actor.ActorRef
import play.api.libs.concurrent.Promise

case class SingleRequest(dataSet: DataSet, resolution: Int, point: Point3D)
case class MultiCubeRequest(requests: Array[CubeRequest])
case class CubeRequest(dataSet: DataSet, resolution: Int, points: Cuboid)

class DataSetActor extends Actor {
  implicit val system = Akka.system

  val BinaryCacheAgent = Agent(Map[DataBlockInformation, Data]().empty)
  val dataStore: DataStore = new FileDataStore(BinaryCacheAgent)
  def receive = {
    case SingleRequest(dataSet, resolution, point) =>
      sender ! dataStore.load(dataSet, resolution, point)
    case CubeRequest(dataSet, resolution, points) =>
      sender ! dataStore.load(dataSet, resolution, points)
    case MultiCubeRequest(requests) =>
      val resultPromis = Promise.sequence(requests.map(r =>
        dataStore.load(r.dataSet, r.resolution, r.points)))
      sender ! resultPromis.map{results => Array.concat(results: _*)}
  }
} 
