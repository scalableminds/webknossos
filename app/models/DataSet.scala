package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.tools.geometry.Point3D

case class DataSet(
    name: String,
    baseDir: String,
    supportedResolutions: List[Int],
    maxCoordinates: Point3D,
    _id: ObjectId = new ObjectId ) {
  val id = _id.toString

  /**
   * Checks if a point is inside the whole data set boundary.
   */
  def doesContain( point: Point3D ) =
    point.x >= 0 && point.y >= 0 && point.z >= 0 && // lower bound
      !( point hasGreaterCoordinateAs maxCoordinates )
}

object DataSet extends BasicDAO[DataSet]( "dataSets" ) {

  def findOneById( id: String ) =
    DataSet.findOneByID( new ObjectId( id ) )

  def default = {
    DataSet.findAll.headOption getOrElse {
      throw new Exception( "No default data set found!" )
    }
  }
}