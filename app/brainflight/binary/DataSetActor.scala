package brainflight.binary

import akka.actor.Actor
import brainflight.tools.geometry.Point3D
import models.DataSet

case class SingleRequest( dataSet: DataSet, resolution: Int, point: Point3D )
case class BlockRequest( dataSet: DataSet, resolution: Int, points: Seq[Point3D])

class DataSetActor extends Actor {
  val dataStore: DataStore = FileDataStore
  def receive = {
    case SingleRequest( dataSet, resolution, point ) =>
      sender ! dataStore.load( dataSet, resolution )( point )
    case BlockRequest( dataSet, resolution, points) =>
      sender ! points.map( dataStore.load( dataSet, resolution) ).toArray
  }
}