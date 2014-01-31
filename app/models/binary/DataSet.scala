package models.binary

import play.api.libs.functional.syntax._
import models.basics._
import play.api.libs.json._
import braingames.binary.models.{DataSourceRepository => AbstractDataSourceRepository, DataSource}
import models.user.User
import braingames.reactivemongo.{DBAccessContext, GlobalDBAccess, SecuredMongoDAO}
import play.api.libs.concurrent.Execution.Implicits._

object DataSetRepository extends AbstractDataSourceRepository with GlobalDBAccess{

  def deleteAllExcept(l: Array[String]) =
    DataSetDAO.deleteAllSourcesExcept(l)

  def updateOrCreate(dataSource: DataSource) =
    DataSetDAO.updateOrCreate(dataSource)

  def removeByName(name: String) =
    DataSetDAO.removeBySourceName(name)

  def findByName(name: String) =
    DataSetDAO.findOneBySourceName(name).map(_.map(_.dataSource))
}

case class DataSet(dataSource: DataSource, allowedTeams: List[String], description: Option[String] = None)

object DataSet{
  implicit val dataSetFormat = Json.format[DataSet]
}

object DataSetDAO extends SecuredBaseDAO[DataSet] {
  val collectionName = "dataSets"

  // Security

  override def findQueryFilter(implicit ctx: DBAccessContext) = {
    ctx.data match{
      case Some(user: User) =>
        AllowIf(Json.obj("allowedTeams" -> Json.obj("$in" -> user.teamNames)))
      case _ =>
        DenyEveryone()
    }
  }

  import braingames.binary.models.DataLayer.dataLayerFormat

  val formatter = DataSet.dataSetFormat

  def default()(implicit ctx: DBAccessContext) =
    findMaxBy("priority")

  def deleteAllSourcesExcept(names: Array[String])(implicit ctx: DBAccessContext) =
    collectionRemove(Json.obj("dataSource.name" -> Json.obj("$nin" -> names)))

  def findOneBySourceName(name: String)(implicit ctx: DBAccessContext) =
    findOne("dataSource.name", name)

  def updateOrCreate(d: DataSource)(implicit ctx: DBAccessContext) =
    collectionUpdate(
      Json.obj("dataSource.name" -> d.name),
      Json.obj(
        "$set" -> Json.obj("dataSource" -> formatWithoutId(d)),
        "$setOnInsert" -> Json.obj("allowedTeams" -> List(d.owningTeam))
      ),
      upsert = true)

  def removeBySourceName(name: String)(implicit ctx: DBAccessContext) =
    remove("dataSource.name", name)

  def formatWithoutId(ds: DataSource) = {
    val js = Json.toJson(ds)
    js.transform(removeId).getOrElse {
      System.err.println("Couldn't remove ID from: " + js)
      js
    }
  }
}