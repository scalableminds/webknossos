package models.knowledge

import braingames.binary.models.{DataSetRepository => AbstractDataSetRepository, DataSet}
import play.api.libs.json.Json
import braingames.reactivemongo.{DBAccessContext, GlobalDBAccess}
import models.knowledge.basics.BasicReactiveDAO
import play.api.libs.concurrent.Execution.Implicits._

object DataSetRepository extends AbstractDataSetRepository with GlobalDBAccess{

  def deleteAllExcept(l: Array[String]) =
    DataSetDAO.deleteAllExcept(l)

  def updateOrCreate(dataSet: DataSet) =
    DataSetDAO.updateOrCreate(dataSet)

  def removeByName(name: String) =
    DataSetDAO.removeByName(name)

  def findByName(name: String) =
    DataSetDAO.findOneByName(name)
}

object DataSetDAO extends BasicReactiveDAO[DataSet] {
  val collectionName = "dataSets"

  import braingames.binary.models.DataLayer.dataLayerFormat

  implicit val formatter = Json.format[DataSet]

  def default()(implicit ctx: DBAccessContext) =
    findMaxBy("priority")

  def deleteAllExcept(names: Array[String])(implicit ctx: DBAccessContext) =
    collectionRemove(Json.obj("name" -> Json.obj("$nin" -> names)))

  def findOneByName(name: String)(implicit ctx: DBAccessContext) =
    findOne("name", name)

  def updateOrCreate(d: DataSet)(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj("name" -> d.name),
      Json.obj(
        "$set" -> formatWithoutId(d)),
      upsert = true)

  def removeByName(name: String)(implicit ctx: DBAccessContext) =
    remove("name", name)

  def findWithTyp(t: String)(implicit ctx: DBAccessContext) =
    collectionFind(Json.obj("dataLayers.typ" -> t)).cursor[DataSet].toList
}