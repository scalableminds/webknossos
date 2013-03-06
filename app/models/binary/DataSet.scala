package models.binary

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.tools.geometry.Point3D
import play.api.libs.functional.syntax._
import models.basics.BasicDAO
import models.basics.DAOCaseClass
import play.api.libs.json._

//TODO: basedir komplett rausziehen und in config definieren
case class DataSet(
    name: String,
    baseDir: String,
    maxCoordinates: Point3D,
    priority: Int = 0,
    colorLayer: ColorLayer,
    segmentationLayer: Option[SegmentationLayer] = None,
    classificationLayer: Option[ClassificationLayer] = None,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[DataSet] {

  def dao = DataSet
  
  val id = _id.toString
  
  val dataLayers = List(Some(colorLayer),segmentationLayer, classificationLayer).flatten.
    groupBy(_.name).map(pair => (pair._1 -> pair._2.head))

  /**
   * Checks if a point is inside the whole data set boundary.
   */
  def doesContain(point: Point3D) =
    point.x >= 0 && point.y >= 0 && point.z >= 0 && // lower bound
      !(point hasGreaterCoordinateAs maxCoordinates)
  
  def withBaseDir(newBaseDir: String) = copy(baseDir = newBaseDir)   
  
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
  
  def createWithoutBaseDir(name: String, 
      maxCoordinates: Point3D, 
      colorLayer: ColorLayer, 
      segmentationLayer: Option[SegmentationLayer], 
      classificationLayer: Option[ClassificationLayer]) = DataSet(name, "", maxCoordinates, 0, colorLayer, segmentationLayer, classificationLayer)
    
  implicit val DataSetReads: Reads[DataSet] = (
    (__ \ "name").read[String] and
    (__ \ "maxCoordinates").read[Point3D] and
    (__ \ "dataLayers" \ "color").read[ColorLayer] and
    (__ \ "dataLayers" \ "segmentation").readNullable[SegmentationLayer] and
    (__ \ "dataLayers" \ "classification").readNullable[ClassificationLayer])(createWithoutBaseDir _)

}