package models.binary

import play.api.libs.functional.syntax._
import models.basics._
import play.api.libs.json._
import braingames.binary.models.{DataSourceRepository => AbstractDataSourceRepository, DataSource}
import models.user.User
import braingames.reactivemongo.{DefaultAccessDefinitions, DBAccessContext, GlobalDBAccess, SecuredMongoDAO}
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.AccessRestrictions.AllowIf

object DataSetRepository extends AbstractDataSourceRepository with GlobalDBAccess {

  def deleteAllExcept(l: Array[String]) =
    DataSetDAO.deleteAllSourcesExcept(l)

  def updateOrCreate(dataSource: DataSource) =
    DataSetDAO.updateOrCreate(dataSource)

  def removeByName(name: String) =
    DataSetDAO.removeBySourceName(name)

  def findByName(name: String) =
    DataSetDAO.findOneBySourceName(name).map(_.dataSource)
}

case class DataSet(
                    dataSource: DataSource,
                    isPublic: Boolean = false,
                    allowedTeams: List[String],
                    description: Option[String] = None,
                    created: Long = System.currentTimeMillis()) {
  def isEditableBy(user: User) =
    user.adminTeamNames.contains(dataSource.owningTeam)
}

object DataSet {
  implicit val dataSetFormat = Json.format[DataSet]
}

object DataSetService {
  def updateTeams(dataSet: DataSet, teams: List[String])(implicit ctx: DBAccessContext) =
    DataSetDAO.updateTeams(dataSet.dataSource.name, teams)
}

object DataSetDAO extends SecuredBaseDAO[DataSet] {
  val collectionName = "dataSets"

  // Security
  override val AccessDefinitions = new DefaultAccessDefinitions {
    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(
            Json.obj("$or" -> Json.arr(
              Json.obj("isPublic" -> true),
              Json.obj("allowedTeams" -> Json.obj("$in" -> user.teamNames)),
              Json.obj("dataSource.owningTeam" -> Json.obj("$in" -> user.adminTeamNames))
            )))
        case _ =>
          AllowIf(
            Json.obj("isPublic" -> true)
          )
      }
    }
  }

  import braingames.binary.models.DataLayer.dataLayerFormat

  val formatter = DataSet.dataSetFormat

  def byNameQ(name: String) =
    Json.obj("dataSource.name" -> name)

  def default()(implicit ctx: DBAccessContext) =
    findMaxBy("priority")

  def deleteAllSourcesExcept(names: Array[String])(implicit ctx: DBAccessContext) =
    remove(Json.obj("dataSource.name" -> Json.obj("$nin" -> names)))

  def findOneBySourceName(name: String)(implicit ctx: DBAccessContext) =
    findOne(byNameQ(name))

  def findAllOwnedBy(teams: List[String])(implicit ctx: DBAccessContext) =
    find(Json.obj("dataSource.owningTeam" -> Json.obj("$in" -> teams))).cursor[DataSet].collect[List]()

  def updateOrCreate(d: DataSource)(implicit ctx: DBAccessContext) =
    update(
      byNameQ(d.name),
      Json.obj(
        "$set" -> Json.obj("dataSource" -> formatWithoutId(d)),
        "$setOnInsert" -> Json.obj(
          "allowedTeams" -> List(d.owningTeam),
          "created" -> System.currentTimeMillis,
          "isPublic" -> false
        )
      ),
      upsert = true)

  def removeBySourceName(name: String)(implicit ctx: DBAccessContext) =
    remove(byNameQ(name))

  def formatWithoutId(ds: DataSource) = {
    val js = Json.toJson(ds)
    js.transform(removeId).getOrElse {
      System.err.println("Couldn't remove ID from: " + js)
      js
    }
  }

  def updateTeams(name: String, teams: List[String])(implicit ctx: DBAccessContext) =
    update(
      byNameQ(name),
      Json.obj("$set" -> Json.obj(
        "allowedTeams" -> teams)))
}