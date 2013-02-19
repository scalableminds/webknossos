package models.binary

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.tools.geometry.Point3D
import models.basics.BasicDAO
import models.basics.DAOCaseClass
import play.api.libs.json._


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
      
  def updateDataLayers(newDataLayers: Map[String, DataLayer]) = {
    update(_.copy(dataLayers = newDataLayers))  
  }    
}

object DataSet extends BasicDAO[DataSet]("dataSets") {

  def default = {
    //find(MongoDBObject())
    
    val all = DataSet.findAll
    if (all.isEmpty)
      throw new Exception("No default data set found!")
    all.maxBy(_.priority)
  }
  
  val availableDataLayers = List(ColorLayer.identifier, SegmentationLayer.identifier, ClassificationLayer.identifier)
  
  def deleteAllExcept(names: Array[String]) = {
    removeByIds(DataSet.findAll.filterNot( d => names.contains(d.name)).map(_._id))
  }

  def findOneByName(name: String) =
    findOne(MongoDBObject("name" -> name))

  def updateOrCreate(d: DataSet) = {
    findOne(MongoDBObject("name" -> d.name)) match {
      case Some(stored) =>
        stored.update(_ => d.copy(_id = stored._id, priority = stored.priority, dataLayers = stored.dataLayers))
      case _ =>
        insertOne(d)
    }
  }

  def removeByName(name: String) {
    DataSet.remove(MongoDBObject("name" -> name))
  }
  
  implicit object DataSetReads extends Reads[DataSet] {
    val NAME="name"
    val BASE_DIR="baseDir"
    val MAX_COORDINATES="maxCoordinates"
    val PRIORITY="priority"
    val DATALAYERS="dataLayers"
      
    def reads(js: JsValue) = {
      val dataLayers = (
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
          (js \ BASE_DIR).as[String],
          Point3D.fromList((js \ MAX_COORDINATES).as[List[Int]]),
          (js \ PRIORITY).as[Int],
          dataLayers))
    }
  }
}