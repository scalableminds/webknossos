package models.knowledge

import models.basics.{DBAccessContext, SecuredMongoDAO, GlobalDBAccess}
import braingames.binary.models.{DataSetRepository => AbstractDataSetRepository, DataSet}
import play.api.libs.json.Json


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

object DataSetDAO extends SecuredMongoDAO[DataSet] {
  val collectionName = "dataSets"

  // Security

  override def findQueryFilter(implicit ctx: DBAccessContext) = {
    ctx.user match{
      case Some(user) =>
        AllowIf(Json.obj("$or" -> user.teams.map(t =>
          Json.obj(
            "allowedTeams" -> Json.obj("$regex" -> t.teamPath.toRegex)))))
      case _ =>
        DenyEveryone()
    }
  }

  import braingames.binary.models.DataLayer.dataLayerFormat

  val formatter = Json.format[DataSet]

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

}