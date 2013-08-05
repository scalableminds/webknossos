package models.binary

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import braingames.geometry.Point3D
import play.api.libs.functional.syntax._
import models.basics._
import play.api.libs.json._
import braingames.binary.models.DataSet
import braingames.binary.models.{DataSetRepository => AbstractDataSetRepository}
import scala.concurrent.Future
import com.novus.salat._
import braingames.binary.models.DataSet
import models.user.User
import braingames.reactivemongo.{DBAccessContext, GlobalDBAccess, SecuredMongoDAO}
import models.team.TeamPath

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

  // Security

  def allUserAccess = {
    Json.obj("allowedTeams" -> TeamPath.All)
  }

  def teamRegexesForUser(user: User) = user.teams.map{t =>
    Json.obj(
      "allowedTeams" -> Json.obj("$regex" -> t.teamPath.toRegex))}

  override def findQueryFilter(implicit ctx: DBAccessContext) = {
    ctx.data match{
      case Some(user: User) =>
        AllowIf(Json.obj("$or" -> JsArray(allUserAccess :: teamRegexesForUser(user))))
      case _ =>
        AllowIf(Json.obj(
          "allowedTeams" -> TeamPath.All))
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