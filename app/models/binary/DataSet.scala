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
        AllowIf(Json.obj("allowedTeams" -> Json.obj("$in" -> user.teams)))
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
        "$seet" -> formatWithoutId(d)),
      upsert = true)

  def removeByName(name: String)(implicit ctx: DBAccessContext) =
    remove("name", name)

}