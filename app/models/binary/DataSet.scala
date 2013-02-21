package models.binary

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.tools.geometry.Point3D
import models.basics.BasicDAO
import models.basics.DAOCaseClass
import play.api.libs.json._

//TODO: basedir komplett rausziehen und in config definieren
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
  
  implicit object DataSetReads extends Reads[DataSet] {
    val NAME="name"
    val MAX_COORDINATES="maxCoordinates"
    val PRIORITY="priority"
    val DATALAYERS="dataLayers"
      
    def reads(js: JsValue) = {
      val newDataLayers = (
        ((js \ DATALAYERS \ ColorLayer.identifier).asOpt[ColorLayer] match {
          case Some(layer) => Map(ColorLayer.identifier -> layer)
          case _ => Map()
        }) ++
        ((js \ DATALAYERS \ SegmentationLayer.identifier).asOpt[SegmentationLayer] match {
          case Some(layer) => Map(SegmentationLayer.identifier -> layer)
          case _ => Map()
        })++
        ((js \ DATALAYERS \ ClassificationLayer.identifier).asOpt[ClassificationLayer] match {
          case Some(layer) => Map(ClassificationLayer.identifier -> layer)
          case _ => Map()
        })
      )
        
      JsSuccess(DataSet(
          (js \ NAME).as[String],
          "", //BaseDir
          Point3D.fromList((js \ MAX_COORDINATES).as[List[Int]]),
          dataLayers = newDataLayers))
    }
  }
}