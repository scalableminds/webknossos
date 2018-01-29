package models.binary

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{UnusableDataSource, InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.models.datasource.{AbstractDataLayer, AbstractSegmentationLayer, Category, DataResolution, DataSourceId, ElementClass, GenericDataSource, DataLayerLike => DataLayer}
import com.scalableminds.webknossos.schema.Tables._
import models.configuration.DataSetConfiguration
import models.task.TaskSQLDAO.parseArrayTuple
import models.team.{TeamSQL, TeamSQLDAO}
import models.user.User
import net.liftweb.common.Full
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.utils.UriEncoding
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO, SimpleSQLDAO}
import views.html.helper.select


case class DataSetSQL(
                     _id: ObjectId,
                     _datastore: ObjectId,
                     _team: ObjectId,
                     defaultConfiguration: Option[JsObject] = None,
                     description: Option[String] = None,
                     isPublic: Boolean,
                     isUsable: Boolean,
                     name: String,
                     scale: Option[Scale],
                     status: String,
                     created: Long = System.currentTimeMillis(),
                     isDeleted: Boolean = false
                     )

object DataSetSQLDAO extends SQLDAO[DataSetSQL, DatasetsRow, Datasets] {
  val collection = Datasets

  def idColumn(x: Datasets): Rep[String] = x._Id
  def isDeletedColumn(x: Datasets): Rep[Boolean] = x.isdeleted

  private def parseScaleOpt(literalOpt: Option[String]): Fox[Option[Scale]] = literalOpt match {
    case Some(literal) => for {
      scale <- Scale.fromList(parseArrayTuple(literal).map(_.toFloat)) ?~> "could not parse edit position"
    } yield Some(scale)
    case None => Fox.successful(None)
  }

  private def writeScaleLiteral(scale: Scale): String =
    writeArrayTuple(List(scale.x, scale.y, scale.z).map(_.toString))

  def parse(r: DatasetsRow): Fox[DataSetSQL] = {
    for {
      scale <- parseScaleOpt(r.scale)
    } yield {
      DataSetSQL(
        ObjectId(r._Id),
        ObjectId(r._Datastore),
        ObjectId(r._Team),
        r.defaultconfiguration.map(Json.parse(_).as[JsObject]),
        r.description,
        r.ispublic,
        r.isusable,
        r.name,
        scale,
        r.status,
        r.created.getTime,
        r.isdeleted
      )
    }
  }
  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[DataSetSQL] =
    for {
      rOpt <- run(Datasets.filter(r => notdel(r) && r.name === name).result.headOption)
      r <- rOpt.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def updateFieldsByName(name: String, description: Option[String], isPublic: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- Datasets if (notdel(row) && row.name === name)} yield (row.description, row.ispublic)
    for {_ <- run(q.update(description, isPublic))} yield ()
  }

  def updateDataSourceByName(name: String, dataStoreName: String, source: InboxDataSource, isUsable: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] = {

    for {
      old <- findOneByName(name)
      team <- TeamSQLDAO.findOneByName(source.id.team)
      q = sqlu"""update webknossos.dataSets
                    set _dataStore = ${dataStoreName},
                        _team = ${team._id.id},
                        isUsable = ${isUsable},
                        scale = #${optionLiteral(source.scaleOpt.map(s => writeScaleLiteral(s)))},
                        status ${source.statusOpt.getOrElse("")} =
                   where id = ${old._id}"""
      _ <- run(q)
      _ <- DataSetDataLayerSQLDAO.updateLayers(old._id, source)
    } yield ()
  }
  //to update: dataStore (find by url), isUsable, team (find by name), datalayers (in other collection), scale, status
}


object DataSetResolutionsSQLDAO extends SimpleSQLDAO {

  def parseRow(row: DatasetResolutionsRow): Fox[DataResolution] = {
    for {
      scale <- Point3D.fromList(parseArrayTuple(row.scale).map(_.toInt))
    } yield {
      DataResolution(row.resolution, scale)
    }
  }

  def findDataResolutionForLayer(dataSetId: ObjectId, dataLayerName: String): Fox[List[DataResolution]] = {
    for {
      rows <- run(DatasetResolutions.filter(r => r._Dataset === dataSetId.id && r.datalayername === dataLayerName).result).map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow))
    } yield {
      rowsParsed
    }
  }

}


object DataSetDataLayerSQLDAO extends SimpleSQLDAO {

  def parseRow(row: DatasetLayersRow, dataSetId: ObjectId): Fox[DataLayer] = {
    val result: Fox[Fox[DataLayer]] = for {
      category <- Category.fromString(row.category).toFox
      boundingBox <- BoundingBox.fromSQL(parseArrayTuple(row.boundingbox).map(_.toInt)).toFox
      elementClass <- ElementClass.fromString(row.elementclass).toFox
      resolutions <- DataSetResolutionsSQLDAO.findDataResolutionForLayer(dataSetId, row.name)
    } yield {
      (row.largestsegmentid, row.mappings) match {
        case (Some(segmentId), Some(mappings)) =>
                                  Fox.successful(AbstractSegmentationLayer(
                                  row.name,
                                  category,
                                  boundingBox,
                                  resolutions,
                                  elementClass,
                                  segmentId,
                                  parseArrayTuple(mappings).toSet
                                ))
        case (None, None) => Fox.successful(AbstractDataLayer(
                                  row.name,
                                  category,
                                  boundingBox,
                                  resolutions,
                                  elementClass
                                ))
        case _ => Fox.failure("")
      }
    }
    result.flatten
  }

  def findDataLayersForDataSet(dataSetId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[DataLayer]] = {
    for {
      rows <- run(DatasetLayers.filter(_._Dataset === dataSetId.id).result).map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow(_, dataSetId)))
    } yield {
      rowsParsed
    }
  }

  def updateLayers(_dataSet: ObjectId, source: InboxDataSource)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.dataset_layers where _dataSet = (select _id from webknossos.dataSets where _id = ${_dataSet})"
    val insertQuerys = source.toUsable match {
      case Some(usable) => {
        usable.dataLayers.map { layer =>
          layer match {
            case AbstractSegmentationLayer(name, category, bbox, resolutions, elementClass, segmentId, mappings) => {
              sqlu"""insert into webknossos.dataset_layers(_dataSet, name, category, elementClass, boundingBox, largestSegmentId, mappings)
                    values(${_dataSet}, ${name}, '#${category}', …TODO)
                  """
            }
            case AbstractDataLayer(name, category, bbox, resolutions, elementClass) => {
              sqlu"…TODO"
            }
              //TODO: update resolutions table
            case _ => throw new Exception("DataLayer type mismatch")
          }
        }
      }
      case None => Fox.failure("todo")
    }
  }
}



object DataSetAllowedTeamsSQLDAO extends SimpleSQLDAO {

  def findAllowedTeamsForDataSet(dataSetId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[String]] = {

    val query = for {
      (allowedteam, team) <- DatasetAllowedteams.filter(_._Dataset === dataSetId.id) join Teams  on (_._Team === _._Id)
    } yield team.name

    run(query.result).map(_.toList)

  }

  def updateAllowedTeamsForDataSetByName(dataSetName: String, allowedTeams: List[String])(implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = sqlu"""delete from webknossos.dataSet_allowedTeams
                             where _dataSet = (
                               select _id from webknossos.dataSets where name = ${dataSetName}
                             )"""

    val insertQueries = allowedTeams.map(teamName => sqlu"""insert into  webknossos.dataSet_allowedTeams(_dataSet, _team)
                                                              values((select _id from webknossos.dataSets where name = ${dataSetName}),
                                                                     (select _id from webknossos.teams where name = ${teamName}))""")

    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
      for { //note that t.created is skipped
        _ <- run(composedQuery.transactionally)
      } yield ()
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

  private def constructDatasource(s: DataSetSQL, team: TeamSQL)(implicit ctx: DBAccessContext): Fox[InboxDataSource] = {
    val dataSourceId = DataSourceId(s.name, team.name)
    for {
      dataLayersBox <- DataSetDataLayerSQLDAO.findDataLayersForDataSet(s._id).futureBox
    } yield {
      dataLayersBox match {
        case Full(dataLayers) =>
          for {
            scale <- s.scale
          } yield GenericDataSource[DataLayer](dataSourceId, dataLayers, scale)
        case _ =>
          Some(UnusableDataSource[DataLayer](dataSourceId, s.status, s.scale))
      }
    }
  }

  def fromDataSetSQL(s: DataSetSQL)(implicit ctx: DBAccessContext) = {
    for {
      datastore <- DataStoreSQLDAO.findOne(s._datastore)
      allowedTeams <- DataSetAllowedTeamsSQLDAO.findAllowedTeamsForDataSet(s._id)
      defaultConfiguration <- parseDefaultConfiguration(s.defaultConfiguration)
      team <- TeamSQLDAO.findOne(s._team)
      dataSource <- constructDatasource(s, team)
    } yield {
      DataSet(
        DataStoreInfo(datastore.name, datastore.url, datastore.typ),
        dataSource,
        allowedTeams,
        s.isUsable,
        s.isPublic,
        s.description,
        defaultConfiguration,
        s.created
      )
    }
  }
}

object DataSetDAO {

  val collectionName = "dataSets"

  val formatter = DataSet.dataSetFormat

/*  underlying.indexesManager.ensure(Index(Seq("dataSource.id.name" -> IndexType.Ascending)))*/

/*  override val AccessDefinitions = new DefaultAccessDefinitions {
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
  }*/

  def findOneBySourceName(name: String)(implicit ctx: DBAccessContext): Fox[DataSet] = {
    for {
      dataSetSQL <- DataSetSQLDAO.findOneByName(name)
      dataSet <- DataSet.fromDataSetSQL(dataSetSQL)
    } yield dataSet
  }

  def updateDataSource(
    name: String,
    dataStoreInfo: DataStoreInfo,
    source: InboxDataSource,
    isActive: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] = {}
    DataSetSQLDAO.updateDataSourceByName(name, dataStoreInfo.name, source, isActive)

  def updateTeams(name: String, teams: List[String])(implicit ctx: DBAccessContext) =
    DataSetAllowedTeamsSQLDAO.updateAllowedTeamsForDataSetByName(name, teams)

  def update(name: String, description: Option[String], isPublic: Boolean)(implicit ctx: DBAccessContext): Fox[DataSet] = {
    for {
      _ <- DataSetSQLDAO.updateFieldsByName(name, description, isPublic)
      updated <- findOneBySourceName(name)
    } yield updated
  }

  def insert(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[Unit] = Fox.failure("todo")

  def findAll: Fox[List[DataSet]] = Fox.failure("todo")

  def count(implicit ctx: DBAccessContext): Fox[Int] = DataSetSQLDAO.countAll

  def deactivateUnreportedDataSources(dataStoreName: String, dataSources: List[InboxDataSource])(implicit ctx: DBAccessContext): Fox[Unit] = Fox.failure("todo")
  /*
  {
    DataSetDAO.update(
      Json.obj(
        "dataStoreInfo.name" -> dataStoreName,
        "dataSource.id.name" -> Json.obj("$nin" -> Json.arr(dataSources.map(_.id.name)))),
      Json.obj(
        "$set" -> Json.obj(
          "isActive" -> false,
          "dataSource.status" -> "No longer available on datastore."),
        // we need this $unset, so the data source will not be considered imported during deserialization
        "$unset" -> Json.obj("dataSource.dataLayers" -> "")
      ),
      multi = true)*/
}
