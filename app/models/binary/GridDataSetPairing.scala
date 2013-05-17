package models.binary

import play.mvc._
import braingames.binary.models.DataSet
import reactivemongo.bson.Macros
import reactivemongo.bson.BSONObjectID
import reactivemongo.api._
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import braingames.binary.models.DataLayer
import play.api.libs.json.Json
import org.bson.BSONObject
import reactivemongo.bson.BSONDocument
import reactivemongo.bson.BSONInteger
import reactivemongo.bson.BSONString
import reactivemongo.bson.BSONLong
/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 10.12.11
 * Time: 12:58
 */
case class GridDataSetPairing(dataSetName: String, dataLayerBaseDir: String, resolution: Int, dataPrefix: Long, _id: BSONObjectID = BSONObjectID.generate) {
  def id = _id.toString
}

object GridDataSetPairing {
  import models.context.BinaryDB._

  implicit val gridDataSetMacro = Macros.handler[GridDataSetPairing]

  val collection = db.collection("dataSetPairing")

  def findPrefix(dataSetName: String, dataLayerBaseDir: String, resolution: Int) = {
    val query = BSONDocument(
      "dataSetName" -> BSONString(dataSetName),
      "dataLayerBaseDir" -> BSONString(dataLayerBaseDir),
      "resolution" -> BSONInteger(resolution))

    // get a Cursor[BSONDocument]
    val cursor = collection.find(query).cursor
    cursor.headOption.map(_.map(_.dataPrefix))
  }

  private def createNextPrefix: Future[Long] = {
    collection.find(BSONDocument.empty).cursor.toList.map(_.map(_.dataPrefix)).map { prefixValues =>
      if (prefixValues.isEmpty) {
        0
      } else {
        prefixValues.max + 1
      }
    }
  }

  def getOrCreatePrefix(dataSet: DataSet, dataLayer: DataLayer, resolution: Int) = {
    findPrefix(dataSet.name, dataLayer.baseDir, resolution).flatMap {
      case Some(p) => Future.successful(p)
      case _ =>
        createNextPrefix.map { prefix =>
          collection.insert(GridDataSetPairing(dataSet.name, dataLayer.baseDir, resolution, prefix))
          prefix
        }
    }
  }
}
