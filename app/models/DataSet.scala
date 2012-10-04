package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.tools.geometry.Point3D
import models.basics.BasicDAO

case class DataSet(
    name: String,
    baseDir: String,
    supportedResolutions: List[Int],
    maxCoordinates: Point3D,
    priority: Int = 0,
    _id: ObjectId = new ObjectId) {
  val id = _id.toString

  /**
   * Checks if a point is inside the whole data set boundary.
   */
  def doesContain(point: Point3D) =
    point.x >= 0 && point.y >= 0 && point.z >= 0 && // lower bound
      !(point hasGreaterCoordinateAs maxCoordinates)
}

object DataSet extends BasicDAO[DataSet]("dataSets") {
  def default = {
    //find(MongoDBObject())
    DataSet.findAll.headOption getOrElse {
      throw new Exception("No default data set found!")
    }
  }
  
  def findOneByName(name: String) = 
    findOne( MongoDBObject( "name" -> name))

  def updateOrCreate(d: DataSet) {
    findOne(MongoDBObject("name" -> d.name)) match {
      case Some(stored) =>
        save(d.copy(_id = stored._id))
      case _ =>
        save(d)
    }
  }

  def removeByName(name: String) {
    DataSet.remove(MongoDBObject("name" -> name))
  }
}