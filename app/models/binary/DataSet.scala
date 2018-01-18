package models.binary

import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSourceLike => InboxDataSource}
import com.scalableminds.util.reactivemongo.AccessRestrictions.AllowIf
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.schema.Tables._
import models.basics._
import models.configuration.DataSetConfiguration
import models.team.{Role, TeamMembership}
import models.user.User
import models.user.UserExperiencesSQLDAO.db
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.utils.UriEncoding
import reactivemongo.api.indexes.{Index, IndexType}
import slick.lifted.Rep
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO}


case class DataSetSQL(
                     _id: ObjectId,
                     _datastore: ObjectId,
                     _team: ObjectId,
                     defaultConfiguration: Option[JsObject] = None,
                     description: Option[String] = None,
                     isPublic: Boolean,
                     name: String,
                     created: Long = System.currentTimeMillis(),
                     isDeleted: Boolean = false
                     )

object DataSetSQLDAO extends SQLDAO[DataSetSQL, DatasetsRow, Datasets] {
  val collection = Datasets

  def idColumn(x: Datasets): Rep[String] = x._Id
  def isDeletedColumn(x: Datasets): Rep[Boolean] = x.isdeleted

  def parse(r: DatasetsRow): Fox[DataSetSQL] =
    Fox.successful(DataSetSQL(
        ObjectId(r._Id),
        ObjectId(r._Datastore),
        ObjectId(r._Team),
        r.defaultconfiguration.map(Json.parse(_).as[JsObject]),
        r.description,
        r.ispublic,
        r.name,
        r.created.getTime,
        r.isdeleted
      ))
}




object DataSetAllowedTeamsSQLDAO extends FoxImplicits {
  val db = Database.forConfig("postgres")

  def findAllowedTeamsForDataSet(dataSetId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[String]] = {

    val query = for {
      (allowedteam, team) <- DatasetAllowedteams.filter(_._Dataset === dataSetId.id) join Teams  on (_._Team === _._Id)
    } yield team.name

    db.run(query.result).map(_.toList)

  }
}

case class DataSet(
  dataStoreInfo: DataStoreInfo,
  dataSource: InboxDataSource,
  allowedTeams: List[String],
  isActive: Boolean = false,
  isPublic: Boolean = false,
  description: Option[String] = None,
  defaultConfiguration: Option[DataSetConfiguration] = None,
  created: Long = System.currentTimeMillis()) {

  def name = dataSource.id.name

  def owningTeam = dataSource.id.team

  def urlEncodedName: String =
    UriEncoding.encodePathSegment(name, "UTF-8")

  def isEditableBy(user: Option[User]) =
    user.exists(_.isAdminOf(owningTeam))

  lazy val dataStore: DataStoreHandlingStrategy =
    DataStoreHandlingStrategy(this)
}

object DataSet extends FoxImplicits {
  implicit val dataSetFormat = Json.format[DataSet]

  def dataSetPublicWrites(user: Option[User]): Writes[DataSet] =
    ((__ \ 'name).write[String] and
      (__ \ 'dataSource).write[InboxDataSource] and
      (__ \ 'dataStore).write[DataStoreInfo] and
      (__ \ 'owningTeam).write[String] and
      (__ \ 'allowedTeams).write[List[String]] and
      (__ \ 'isActive).write[Boolean] and
      (__ \ 'isPublic).write[Boolean] and
      (__ \ 'description).write[Option[String]] and
      (__ \ 'created).write[Long] and
      (__ \ "isEditable").write[Boolean]) (d =>
      (d.name, d.dataSource, d.dataStoreInfo, d.owningTeam, d.allowedTeams, d.isActive, d.isPublic, d.description, d.created, d.isEditableBy(user)))


  private def parseDefaultConfiguration(jsValueOpt: Option[JsValue]): Fox[Option[DataSetConfiguration]] = jsValueOpt match {
    case Some(jsValue) => for {
                            conf <- JsonHelper.jsResultToFox(jsValue.validate[DataSetConfiguration])
                          } yield Some(conf)
    case None => Fox.successful(None)
  }

  def fromDatasetSQL(s: DataSetSQL)(implicit ctx: DBAccessContext) = {
    for {
      datastore <- DataStoreSQLDAO.findOne(s._datastore)
      allowedTeams <- DataSetAllowedTeamsSQLDAO.findAllowedTeamsForDataSet(s._id)
      defaultConfiguration <- parseDefaultConfiguration(s.defaultConfiguration)
    } yield {
      DataSet(
        DataStoreInfo(datastore.name, datastore.url, datastore.typ),
        dataSource,
        allowedTeams,
        !s.isDeleted,
        s.isPublic,
        s.description,
        defaultConfiguration,
        s.created
      )
    }
  }
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
              Json.obj("allowedTeams" -> Json.obj("$in" -> user.teamNames)),
              Json.obj("owningTeam" -> Json.obj("$in" -> user.adminTeamNames))
            )))
        case _                =>
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

  def updateTeams(name: String, teams: List[String])(implicit ctx: DBAccessContext) =
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
