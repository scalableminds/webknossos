package models.binary

import play.mvc._
import reactivemongo.bson.Macros
import reactivemongo.bson.BSONObjectID
import reactivemongo.api._
import scala.concurrent.Future
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import org.bson.BSONObject
import reactivemongo.bson.BSONDocument
import reactivemongo.bson.BSONInteger
import reactivemongo.bson.BSONString
import reactivemongo.bson.BSONLong
import braingames.binary.models._
/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 10.12.11
 * Time: 12:58
 */
case class GridDataSetPairing(dataSetName: String, dataLayerTyp: String, dataLayerSection: Option[String], resolution: Int, dataPrefix: Long, _id: BSONObjectID = BSONObjectID.generate) {
  def id = _id.toString
}

object GridDataSetPairing {
  import models.context.BinaryDB._

  implicit val gridDataSetMacro = Macros.handler[GridDataSetPairing]

  val collection = db.collection("dataSetPairing")

  def findPrefix(dataSetName: String, dataLayerId: DataLayerId, resolution: Int) = {
    val sectionQuery =
      dataLayerId.section.map { section =>
        BSONDocument("dataLayerSection" -> BSONString(section))
      } getOrElse BSONDocument.empty

    val query = BSONDocument(
      "dataSetName" -> BSONString(dataSetName),
      "dataLayerTyp" -> BSONString(dataLayerId.typ),
      "resolution" -> BSONInteger(resolution)) ++ sectionQuery

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

  def getOrCreatePrefix(dataSet: DataSet, dataLayerId: DataLayerId, resolution: Int) = {
    findPrefix(dataSet.name, dataLayerId, resolution).flatMap {
      case Some(p) => Future.successful(p)
      case _ =>
        createNextPrefix.map { prefix =>
          collection.insert(GridDataSetPairing(dataSet.name, dataLayerId.typ, dataLayerId.section, resolution, prefix))
          prefix
        }
    }
  }
}
