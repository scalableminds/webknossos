package models.binary

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import braingames.geometry.Point3D
import play.api.libs.functional.syntax._
import models.basics.BasicDAO
import models.basics.DAOCaseClass
import play.api.libs.json._

case class BareDataSet(name: String ,maxCoordinates: Point3D, priority: Int = 0) {
  def addLayers(baseDir: String,
      colorLayer: ColorLayer, 
      segmentationLayers: List[SegmentationLayer] = Nil, 
      classificationLayer: Option[ClassificationLayer] = None) = {
    DataSet(name, baseDir, maxCoordinates, priority, colorLayer, segmentationLayers, classificationLayer)
  }
  
}

object BareDataSet extends Function3[String, Point3D, Int, BareDataSet]{
  
  implicit val BareDataSetReads: Reads[BareDataSet] = Json.reads[BareDataSet]
}

//TODO: basedir komplett rausziehen und in config definieren
case class DataSet(
    name: String,
    baseDir: String,
    maxCoordinates: Point3D,
    priority: Int = 0,
    colorLayer: ColorLayer,
    segmentationLayers: List[SegmentationLayer] = Nil,
    classificationLayer: Option[ClassificationLayer] = None,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[DataSet] {

  def dao = DataSet
  
  val id = _id.toString
  
  val dataLayers = ((colorLayer :: segmentationLayers)).groupBy(layer => layer.name).mapValues(list => list.head)
  
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
  
  def deleteAllExcept(names: Array[String]) = {
    removeByIds(DataSet.findAll.filterNot( d => names.contains(d.name)).map(_._id))
  }

  def findOneByName(name: String) =
    findOne(MongoDBObject("name" -> name))

  def updateOrCreate(d: DataSet) = {
    findOne(MongoDBObject("name" -> d.name)) match {
      case Some(stored) =>
        stored.update(_ => d.copy(_id = stored._id, priority = stored.priority))
      case _ =>
        insertOne(d)
    }
  }

  def removeByName(name: String) {
    DataSet.remove(MongoDBObject("name" -> name))
  }
  
}