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