package models.binary

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.tools.geometry.Point3D
import models.basics.BasicDAO
import models.basics.DAOCaseClass

case class DataSet(
    name: String,
    baseDir: String,
    maxCoordinates: Point3D,
    priority: Int = 0,
    dataLayers: Map[String, DataLayer] = Map(ColorLayer.identifier -> ColorLayer.default),
    _id: ObjectId = new ObjectId) extends DAOCaseClass[DataSet] {

  def dao = DataSet
  
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
    
    val all = DataSet.findAll
    if (all.isEmpty)
      throw new Exception("No default data set found!")
    all.maxBy(_.priority)
  }
  
  

  def findOneByName(name: String) =
    findOne(MongoDBObject("name" -> name))

  def updateOrCreate(d: DataSet) = {
    findOne(MongoDBObject("name" -> d.name)) match {
      case Some(stored) =>
        d.update( _.copy(_id = stored._id, priority = stored.priority))
      case _ =>
        insertOne(d)
    }
  }

  def removeByName(name: String) {
    DataSet.remove(MongoDBObject("name" -> name))
  }
}