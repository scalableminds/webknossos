package models.binary

import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSourceLike => DataSource}
import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.AccessRestrictions.AllowIf
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions}
import models.basics._
import models.configuration.DataSetConfiguration
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.utils.UriEncoding
import reactivemongo.api.indexes.{Index, IndexType}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONObjectIDFormat


case class DataSet(
                    dataStoreInfo: DataStoreInfo,
                    dataSource: InboxDataSource,
                    owningOrganization: String,
                    allowedTeams: List[BSONObjectID],
                    isActive: Boolean = false,
                    isPublic: Boolean = false,
                    description: Option[String] = None,
                    defaultConfiguration: Option[DataSetConfiguration] = None,
                    created: Long = System.currentTimeMillis()) {

  def name = dataSource.id.name

  def urlEncodedName: String =
    UriEncoding.encodePathSegment(name, "UTF-8")

  def isEditableBy(user: Option[User]) =
    user.exists(_.isAdminOf(owningOrganization))

  lazy val dataStore: DataStoreHandlingStrategy =
    DataStoreHandlingStrategy(this)
}

object DataSet {
  implicit val dataSetFormat = Json.format[DataSet]

  def dataSetPublicWrites(user: Option[User]): Writes[DataSet] =
    ((__ \ 'name).write[String] and
      (__ \ 'dataSource).write[InboxDataSource] and
      (__ \ 'dataStore).write[DataStoreInfo] and
      (__ \ 'owningOrganization).write[String] and
      (__ \ 'allowedTeams).write[List[BSONObjectID]] and
      (__ \ 'isActive).write[Boolean] and
      (__ \ 'isPublic).write[Boolean] and
      (__ \ 'description).write[Option[String]] and
      (__ \ 'created).write[Long] and
      (__ \ "isEditable").write[Boolean]) (d =>
      (d.name, d.dataSource, d.dataStoreInfo, d.owningOrganization, d.allowedTeams, d.isActive, d.isPublic, d.description, d.created, d.isEditableBy(user)))
}

object DataSetDAO extends SecuredBaseDAO[DataSet] {

  val collectionName = "dataSets"

  val formatter = DataSet.dataSetFormat

  underlying.indexesManager.ensure(Index(Seq("dataSource.id.name" -> IndexType.Ascending)))

  // Security
  override val AccessDefinitions = new DefaultAccessDefinitions {
    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(
            Json.obj("$or" -> Json.arr(
              Json.obj("isPublic" -> true),
              Json.obj("allowedTeams" -> Json.obj("$in" -> user.teamIds)), //TODO
              Json.obj("owningTeam" -> Json.obj("$in" -> user.supervisorTeams))
            )))
        case _ =>
          AllowIf(
            Json.obj("isPublic" -> true)
          )
      }
    }
  }

  def byNameQ(name: String) =
    Json.obj("dataSource.id.name" -> name)

  def findOneBySourceName(name: String)(implicit ctx: DBAccessContext) =
    findOne(byNameQ(name))

  def updateDataSource(
                        name: String,
                        dataStoreInfo: DataStoreInfo,
                        source: InboxDataSource,
                        isActive: Boolean)(implicit ctx: DBAccessContext) = {
    update(
      byNameQ(name),
      Json.obj("$set" -> Json.obj(
        "dataStoreInfo" -> dataStoreInfo,
        "isActive" -> isActive,
        "dataSource" -> source
      ))
    )
  }

  def updateTeams(name: String, teams: List[BSONObjectID])(implicit ctx: DBAccessContext) =
    update(
      byNameQ(name),
      Json.obj("$set" -> Json.obj(
        "allowedTeams" -> teams)))

  def update(name: String, description: Option[String], isPublic: Boolean)(implicit ctx: DBAccessContext) =
    findAndModify(
      byNameQ(name),
      Json.obj("$set" -> Json.obj(
        "description" -> description,
        "isPublic" -> isPublic)),
      returnNew = true)
}
