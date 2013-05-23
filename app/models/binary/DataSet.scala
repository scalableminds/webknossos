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
import braingames.binary.models.DataSet
import braingames.binary.models.{ DataSetRepository => AbstractDataSetRepository }
import scala.concurrent.Future
import com.novus.salat._

object DataSetRepository extends AbstractDataSetRepository {

  def deleteAllExcept(l: Array[String]) =
    DataSetDAO.deleteAllExcept(l)

  def updateOrCreate(dataSet: DataSet) =
    DataSetDAO.updateOrCreate(dataSet)

  def removeByName(name: String) =
    DataSetDAO.removeByName(name)

  def findByName(name: String) =
    Future.successful(DataSetDAO.findOneByName(name))
}

object DataSetDAO extends BasicDAO[DataSet]("dataSets") {

  def default = {
    //find(MongoDBObject())

    val all = DataSetDAO.findAll
    if (all.isEmpty)
      throw new Exception("No default data set found!")
    all.maxBy(_.priority)
  }

  def deleteAllExcept(names: Array[String]) = {
    remove(MongoDBObject("name" -> MongoDBObject("$nin" -> names)))
  }

  def findOneByName(name: String) =
    findOne(MongoDBObject("name" -> name))

  def updateOrCreate(d: DataSet) = {
    findOne(MongoDBObject("name" -> d.name)) match {
      case Some(stored) =>
        update(
          MongoDBObject("name" -> d.name),
          MongoDBObject("$set" -> grater[DataSet].asDBObject(
            d.copy(priority = stored.priority))))
      case _ =>
        insertOne(d)
    }
  }

  def removeByName(name: String) {
    remove(MongoDBObject("name" -> name))
  }

}