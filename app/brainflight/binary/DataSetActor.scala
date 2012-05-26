package brainflight.binary

import akka.actor.Actor
import brainflight.tools.geometry.Point3D
import models.DataSet
import brainflight.tools.geometry.Cube

case class SingleRequest( dataSet: DataSet, resolution: Int, point: Point3D )
case class CubeRequest( dataSet: DataSet, resolution: Int, points: Cube)

class DataSetActor extends Actor {
  val dataStore: DataStore = new FileDataStore
  def receive = {
    case SingleRequest( dataSet, resolution, point ) =>
      sender ! dataStore.load( dataSet, resolution, point )
    case CubeRequest( dataSet, resolution, cube ) =>
      sender ! dataStore.load( dataSet, resolution, cube )
  }
}