package models.binary

import play.api.libs.functional.syntax._
import models.basics._
import play.api.libs.json._
import braingames.binary.models.{DataSourceRepository => AbstractDataSourceRepository, UsableDataSource, DataSourceLike, UnusableDataSource, DataSource}
import models.user.User
import braingames.reactivemongo.{DefaultAccessDefinitions, DBAccessContext, GlobalDBAccess, SecuredMongoDAO}
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.AccessRestrictions.AllowIf
import braingames.util.FoxImplicits
import oxalis.binary.BinaryDataService
import play.api.Logger
import net.liftweb.common.Full

object DataSetRepository extends AbstractDataSourceRepository with GlobalDBAccess with FoxImplicits {

  def findByName(name: String) =
    DataSetDAO.findOneBySourceName(name).flatMap(_.dataSource)

  def foundDataSources(dataSources: List[DataSourceLike]): Unit = {
    // TODO: this does only work for a single dataSource! datasets need to be assigned a unique id
    Logger.info("Available datasets: " + dataSources.map(_.id).mkString(", "))
    dataSources.map{
      case d: UsableDataSource =>
        DataSetService.updateDataSet(d)
      case d: UnusableDataSource =>
        for{
          _ <- DataSetDAO.removeByName(d.id)
          _ <- DataSetService.createDataSet(d.id, d.sourceType, d.owningTeam, isActive = false)
        } yield true
    }
  }
}

case class DataSet(
                    name: String,
                    dataSource: Option[DataSource],
                    sourceType: String,
                    owningTeam: String,
                    allowedTeams: List[String],
                    isActive: Boolean = false,
                    isPublic: Boolean = false,
                    description: Option[String] = None,
                    created: Long = System.currentTimeMillis()) {
  def isEditableBy(user: Option[User]) =
    user.map(_.adminTeamNames.contains(owningTeam)) getOrElse false
}

object DataSet {
  implicit val dataSetFormat = Json.format[DataSet]

  def dataSetPublicWrites(user: Option[User]): Writes[DataSet] =
    ((__ \ 'name).write[String] and
      (__ \ 'dataSource).write[Option[DataSource]] and
      (__ \ 'sourceType).write[String] and
      (__ \ 'owningTeam).write[String] and
      (__ \ 'allowedTeams).write[List[String]] and
      (__ \ 'isActive).write[Boolean] and
      (__ \ 'isPublic).write[Boolean] and
      (__ \ 'description).write[Option[String]] and
      (__ \ 'created).write[Long] and
      (__ \ "isEditable").write[Boolean])(d =>
    (d.name, d.dataSource, d.sourceType, d.owningTeam, d.allowedTeams, d.isActive, d.isPublic, d.description, d.created, d.isEditableBy(user)))

}

object DataSetService {
  def updateTeams(dataSet: DataSet, teams: List[String])(implicit ctx: DBAccessContext) =
    DataSetDAO.updateTeams(dataSet.name, teams)

  def createDataSet(id: String, sourceType: String, owningTeam: String, dataSource: Option[DataSource] = None, isActive: Boolean = false)(implicit ctx: DBAccessContext) = {
    val dataSet = DataSet(
      id,
      dataSource,
      sourceType,
      owningTeam,
      List(owningTeam),
      isActive = isActive)
    DataSetDAO.insert(dataSet)
  }

  def updateDataSet(usableDataSource: UsableDataSource)(implicit ctx: DBAccessContext) = {
    DataSetDAO.findOneBySourceName(usableDataSource.id).futureBox.map{
      case Full(_) => DataSetDAO.updateDataSource(usableDataSource.id, usableDataSource.dataSource)
      case _ => createDataSet(usableDataSource.id, usableDataSource.sourceType, usableDataSource.owningTeam, Some(usableDataSource.dataSource), isActive = true)
    }
  }

  def importDataSet(dataSet: DataSet)(implicit ctx: DBAccessContext) = {
    BinaryDataService.importDataSource(dataSet.name).map(_.map(_.map { usableDataSource =>
      DataSetDAO.updateDataSource(dataSet.name, usableDataSource.dataSource)
      DataSetDAO.updateActiveState(dataSet.name, true)
      Logger.warn(s"Added datasource '${dataSet.name}' to db")
      usableDataSource
    }))
  }
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
              Json.obj("owningTeam" -> Json.obj("$in" -> user.adminTeamNames))
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
    Json.obj("name" -> name)

  def default()(implicit ctx: DBAccessContext) =
    findMaxBy("priority")

  def deleteAllSourcesExcept(names: Array[String])(implicit ctx: DBAccessContext) =
    remove(Json.obj("name" -> Json.obj("$nin" -> names)))

  def findOneBySourceName(name: String)(implicit ctx: DBAccessContext) =
    findOne(byNameQ(name))

  def findAllOwnedBy(teams: List[String])(implicit ctx: DBAccessContext) =
    find(Json.obj("owningTeam" -> Json.obj("$in" -> teams))).cursor[DataSet].collect[List]()

  def findAllActive(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj("isActive" -> true)).cursor[DataSet].collect[List]()
  }

  def updateDataSource(name: String, dataSource: DataSource)(implicit ctx: DBAccessContext) =
    update(
      Json.obj("name" -> name),
      Json.obj("$set" -> Json.obj(
        "dataSource" -> dataSource
      ))
    )

  def updateActiveState(name: String, isActive: Boolean)(implicit ctx: DBAccessContext) =
    update(
      Json.obj("name" -> name),
      Json.obj("$set" -> Json.obj(
        "isActive" -> isActive
      )))

  def removeByName(name: String)(implicit ctx: DBAccessContext) =
    remove(Json.obj("name" -> name))

  def removeBySourceId(names: List[String])(implicit ctx: DBAccessContext) =
    remove(Json.obj("dataSource.id" -> Json.obj("$in" -> names)))

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