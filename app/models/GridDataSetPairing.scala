package models

import play.api.Play.current
import play.mvc._
import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import models.binary.DataSet
import reactivemongo.api._
import reactivemongo.bson._
import reactivemongo.bson.handlers.DefaultBSONHandlers._
import scala.concurrent.Future
import play.api.libs.concurrent.execution.defaultContext
import reactivemongo.bson.handlers.BSONWriter
import play.api.libs.concurrent.Akka
import models.binary.DataLayer
/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 10.12.11
 * Time: 12:58
 */
case class GridDataSetPairing(dataSetName: String, dataLayerName: String, resolution: Int, dataPrefix: Long, _id: ObjectId = new ObjectId) {
  def id = _id.toString
}

object GridDataSetPairing {
  import models.context.BinaryDB._
  
  implicit object GridDataSetPairingBSONWriter extends BSONWriter[GridDataSetPairing] {
    def toBSON(gridPrairing: GridDataSetPairing) = {
      BSONDocument(
        "_id" -> BSONObjectID(gridPrairing.id),
        "dataSetName" -> BSONString(gridPrairing.dataSetName),
        "dataLayerName" -> BSONString(gridPrairing.dataLayerName),
        "resolution" -> BSONInteger(gridPrairing.resolution),
        "dataPrefix" -> BSONLong(gridPrairing.dataPrefix))
    }
  }

  val collection = db.collection("dataSetPairing")

  def findPrefix(dataSet: DataSet, dataLayer: DataLayer, resolution: Int) = {
    val query = BSONDocument(
        "dataSetName" -> BSONString(dataSet.name),
        "dataLayerName" -> BSONString(dataLayer.folder),
        "resolution" -> BSONInteger(resolution))
        
    // get a Cursor[BSONDocument]
    val cursor = collection.find(query)
    cursor.headOption.map {
      _.map { d =>
        d.getAs[BSONLong]("dataPrefix").get.value
      }
    }
  }

  private def createNextPrefix: Future[Long] = {
    collection.find(BSONDocument()).toList.map(_.map(_.getAs[BSONLong]("dataPrefix").get.value)).map { prefixValues =>
      if (prefixValues.isEmpty) {
        0
      } else {
        prefixValues.max + 1
      }
    }
  }

  def getOrCreatePrefix(dataSet: DataSet, dataLayer: DataLayer, resolution: Int) = {
    findPrefix(dataSet, dataLayer, resolution).flatMap {
      case Some(p) => Akka.future { p }
      case _ =>
        createNextPrefix.map { prefix =>
          collection.insert(GridDataSetPairing(dataSet.name, dataLayer.folder, resolution, prefix))
          prefix
        }
    }
  }
}
