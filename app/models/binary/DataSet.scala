package models.binary


import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import com.scalableminds.util.reactivemongo.AccessRestrictions.AllowIf
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{UnusableDataSource, InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.models.datasource.{AbstractDataLayer, AbstractSegmentationLayer, Category, DataSourceId, ElementClass, GenericDataSource, DataLayerLike => DataLayer}
import com.scalableminds.webknossos.schema.Tables._
import models.basics.SecuredBaseDAO
import models.configuration.DataSetConfiguration
import models.team._
import models.user.User
import net.liftweb.common.Full
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.utils.UriEncoding
import reactivemongo.api.indexes.IndexType
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO, SimpleSQLDAO}

import scala.concurrent.Future
import scala.util.parsing.json.JSONObject


case class DataSetSQL(
                       _id: ObjectId,
                       _dataStore: String,
                       _organization: ObjectId,
                       defaultConfiguration: Option[JsValue] = None,
                       description: Option[String] = None,
                       isPublic: Boolean,
                       isUsable: Boolean,
                       name: String,
                       scale: Option[Scale],
                       status: String,
                       created: Long = System.currentTimeMillis(),
                       isDeleted: Boolean = false
                     )

object DataSetSQL {
  def fromDataSetWithId(d: DataSet, newId: ObjectId)(implicit ctx: DBAccessContext) =
    for {
      organization <- OrganizationSQLDAO.findOneByName(d.dataSource.id.team)
    } yield {
      DataSetSQL(
        newId,
        d.dataStoreInfo.name,
        organization._id,
        d.defaultConfiguration.map(Json.toJson(_)),
        d.description,
        d.isPublic,
        d.isActive,
        d.dataSource.id.name,
        d.dataSource.scaleOpt,
        d.dataSource.statusOpt.getOrElse(""),
        d.created,
        false
      )
    }
}

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
    writeStructTuple(List(scale.x, scale.y, scale.z).map(_.toString))

  def parse(r: DatasetsRow): Fox[DataSetSQL] = {
    for {
      scale <- parseScaleOpt(r.scale)
    } yield {
      DataSetSQL(
        ObjectId(r._Id),
        r._Datastore,
        ObjectId(r._Organization),
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

  override def anonymousReadAccessQ = s"isPublic"

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""isPublic
        or _organization in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin)
        or _id in (select _dataSet
          from (webknossos.dataSet_allowedTeams dt join (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}') ut on dt._team = ut._team))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[DataSetSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select * from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}".as[DatasetsRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[DataSetSQL]] = {
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select * from #${existingCollectionName} where #${accessQuery}".as[DatasetsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[DataSetSQL] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select * from #${existingCollectionName} where name = ${name} and #${accessQuery}".as[DatasetsRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

  def updateFieldsByName(name: String, description: Option[String], isPublic: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- Datasets if (notdel(row) && row.name === name)} yield (row.description, row.ispublic)
    for {
      _ <- run(q.update(description, isPublic))
    } yield ()
  }

  def insertOne(d: DataSetSQL)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      _ <- run(
        sqlu"""insert into webknossos.dataSets(_id, _dataStore, _organization, defaultConfiguration, description, isPublic, isUsable, name, scale, status, created, isDeleted)
               values(${d._id.id}, ${d._dataStore}, ${d._organization.id}, #${optionLiteral(d.defaultConfiguration.map(_.toString).map(sanitize))}, ${d.description}, ${d.isPublic}, ${d.isUsable},
                      ${d.name}, #${optionLiteral(d.scale.map(s => writeScaleLiteral(s)))}, ${d.status.take(1024)}, ${new java.sql.Timestamp(d.created)}, ${d.isDeleted})
            """)
    } yield ()
  }

  def updateDataSourceByName(name: String, dataStoreName: String, source: InboxDataSource, isUsable: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] = {

    for {
      old <- findOneByName(name)
      organization <- OrganizationSQLDAO.findOneByName(source.id.team)
      q =
      sqlu"""update webknossos.dataSets
                    set _dataStore = ${dataStoreName},
                        _organization = ${organization._id.id},
                        isUsable = ${isUsable},
                        scale = #${optionLiteral(source.scaleOpt.map(s => writeScaleLiteral(s)))},
                        status = ${source.statusOpt.getOrElse("")}
                   where _id = ${old._id.id}"""
      _ <- run(q)
      _ <- DataSetDataLayerSQLDAO.updateLayers(old._id, source)
    } yield ()
  }

  def deactivateUnreported(names: List[String], dataStoreName: String): Fox[Unit] = {
    val deleteResolutionsQuery = sqlu"""delete from webknossos.dataSet_resolutions where _dataSet in
              (select _id from webknossos.dataSets where _dataStore = ${dataStoreName}
               and name not in #${writeStructTupleWithQuotes(names.map(sanitize))})"""
    val deleteLayersQuery = sqlu"""delete from webknossos.dataSet_layers where _dataSet in
              (select _id from webknossos.dataSets where _dataStore = ${dataStoreName}
               and name not in #${writeStructTupleWithQuotes(names.map(sanitize))})"""
    val setToUnusableQuery = sqlu"""update webknossos.datasets
               set isUsable = false, status = 'No longer available on datastore.', scale = NULL
               where _dataStore = ${dataStoreName}
               and name not in #${writeStructTupleWithQuotes(names.map(sanitize))}"""
    for {
      _ <-run(DBIO.sequence(List(deleteResolutionsQuery, deleteLayersQuery, setToUnusableQuery)).transactionally)
    } yield ()
  }

}


object DataSetResolutionsSQLDAO extends SimpleSQLDAO {

  def parseRow(row: DatasetResolutionsRow): Fox[Point3D] = {
    for {
      resolution <- Point3D.fromList(parseArrayTuple(row.resolution).map(_.toInt)) ?~> "could not parse resolution"
    } yield resolution
  }

  def findDataResolutionForLayer(dataSetId: ObjectId, dataLayerName: String): Fox[List[Point3D]] = {
    for {
      rows <- run(DatasetResolutions.filter(r => r._Dataset === dataSetId.id && r.datalayername === dataLayerName).result).map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow)) ?~> "could not parse resolution row"
    } yield {
      rowsParsed
    }
  }

  def updateResolutions(_dataSet: ObjectId, dataLayersOpt: Option[List[DataLayer]]): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.dataSet_resolutions where _dataSet = ${_dataSet.id}"
    val insertQueries = dataLayersOpt match {
      case Some(dataLayers: List[DataLayer]) => {
        dataLayers.map { layer =>
          layer.resolutions.map { resolution => {
            sqlu"""insert into webknossos.dataSet_resolutions(_dataSet, dataLayerName, resolution)
                       values(${_dataSet.id}, ${layer.name}, '#${writeStructTuple(resolution.toList.map(_.toString))}')"""
          }
          }
        }.flatten
      }
      case _ => List()
    }
    for {
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries).transactionally)
    } yield ()
  }

}


object DataSetDataLayerSQLDAO extends SimpleSQLDAO {

  def parseRow(row: DatasetLayersRow, dataSetId: ObjectId): Fox[DataLayer] = {
    val result: Fox[Fox[DataLayer]] = for {
      category <- Category.fromString(row.category).toFox ?~> "Could not parse Layer Category"
      boundingBox <- BoundingBox.fromSQL(parseArrayTuple(row.boundingbox).map(_.toInt)).toFox ?~> "Could not parse boundingbox"
      elementClass <- ElementClass.fromString(row.elementclass).toFox ?~> "Could not parse Layer ElementClass"
      resolutions <- DataSetResolutionsSQLDAO.findDataResolutionForLayer(dataSetId, row.name) ?~> "Could not find resolution for layer"
    } yield {
      (row.largestsegmentid, row.mappings) match {
        case (Some(segmentId), Some(mappings)) =>
                                  Fox.successful(AbstractSegmentationLayer(
                                  row.name,
                                  category,
                                  boundingBox,
                                  resolutions.sortBy(_.maxDim),
                                  elementClass,
                                  segmentId,
                                  parseArrayTuple(mappings).toSet
                                ))
        case (None, None) => Fox.successful(AbstractDataLayer(
                                  row.name,
                                  category,
                                  boundingBox,
                                  resolutions.sortBy(_.maxDim),
                                  elementClass
                                ))
        case _ => Fox.failure("Could not match Dataset Layer")
      }
    }
    result.flatten
  }

  def findAllDataLayersForDataSet(dataSetId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[DataLayer]] = {
    for {
      rows <- run(DatasetLayers.filter(_._Dataset === dataSetId.id).result).map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow(_, dataSetId)))
    } yield {
      rowsParsed
    }
  }

  def insertLayerQuery(_dataSet: ObjectId, layer: DataLayer) =
    layer match {
      case s: AbstractSegmentationLayer => {
        sqlu"""insert into webknossos.dataset_layers(_dataSet, name, category, elementClass, boundingBox, largestSegmentId, mappings)
                    values(${_dataSet.id}, ${s.name}, '#${s.category.toString}', '#${s.elementClass.toString}',
                     '#${writeStructTuple(s.boundingBox.toSql.map(_.toString))}', ${s.largestSegmentId}, '#${writeArrayTuple(s.mappings.map(sanitize(_)).toList)}')"""
      }
      case d: AbstractDataLayer => {
        sqlu"""insert into webknossos.dataset_layers(_dataSet, name, category, elementClass, boundingBox)
                    values(${_dataSet.id}, ${d.name}, '#${d.category.toString}', '#${d.elementClass.toString}',
                     '#${writeStructTuple(d.boundingBox.toSql.map(_.toString))}')"""
      }
      case _ => throw new Exception("DataLayer type mismatch")
    }

  def updateLayers(_dataSet: ObjectId, source: InboxDataSource)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.dataset_layers where _dataSet = (select _id from webknossos.dataSets where _id = ${_dataSet.id})"
    val insertQueries = source.toUsable match {
      case Some(usable) => usable.dataLayers.map(insertLayerQuery(_dataSet, _))
      case None => List()
    }
    for {
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries))
      _ <- DataSetResolutionsSQLDAO.updateResolutions(_dataSet, source.toUsable.map(_.dataLayers))
    } yield ()
  }
}


object DataSetAllowedTeamsSQLDAO extends SimpleSQLDAO {

  def findAllForDataSet(dataSetId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[String]] = {
    val query = for {
      (allowedteam, team) <- DatasetAllowedteams.filter(_._Dataset === dataSetId.id) join Teams on (_._Team === _._Id)
    } yield team._Id

    run(query.result).map(_.toList)
  }

  def updateAllowedTeamsForDataSetByName(dataSetName: String, allowedTeams: List[ObjectId])(implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery =
      sqlu"""delete from webknossos.dataSet_allowedTeams
                             where _dataSet = (
                               select _id from webknossos.dataSets where name = ${dataSetName}
                             )"""

    val insertQueries = allowedTeams.map(teamId =>
      sqlu"""insert into webknossos.dataSet_allowedTeams(_dataSet, _team)
                                                              values((select _id from webknossos.dataSets where name = ${dataSetName}),
                                                                     ${teamId.id})""")

    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
    for { //note that t.created is skipped
      _ <- run(composedQuery.transactionally)
    } yield ()
  }
}

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

object DataSet extends FoxImplicits {
  implicit val dataSetFormat = Json.format[DataSet]

  def dataSetPublicWrites(d: DataSet, user: Option[User]): Fox[JsObject] =
    for {
      teams <- Fox.combined(d.allowedTeams.map(TeamDAO.findOneById(_)(GlobalAccessContext)))
      teamsJs <- Future.traverse(teams)(Team.teamPublicWrites(_)(GlobalAccessContext))
    } yield {
      Json.obj("name" -> d.name,
        "dataSource" -> d.dataSource,
        "dataStore" -> d.dataStoreInfo,
        "owningOrganization" -> d.owningOrganization,
        "allowedTeams" -> teamsJs,
        "isActive" -> d.isActive,
        "isPublic" -> d.isPublic,
        "description" -> d.description,
        "created" -> d.created,
        "isEditable" -> d.isEditableBy(user))
    }

  private def parseDefaultConfiguration(jsValueOpt: Option[JsValue]): Fox[Option[DataSetConfiguration]] = jsValueOpt match {
    case Some(jsValue) => for {
      conf <- JsonHelper.jsResultToFox(jsValue.validate[DataSetConfiguration])
    } yield Some(conf)
    case None => Fox.successful(None)
  }

  private def constructDataSource(s: DataSetSQL, organization: OrganizationSQL)(implicit ctx: DBAccessContext): Fox[InboxDataSource] = {
    val dataSourceId = DataSourceId(s.name, organization.name)
    for {
      dataLayersBox <- (DataSetDataLayerSQLDAO.findAllDataLayersForDataSet(s._id) ?~> "could not find data layers").futureBox
    } yield {
      dataLayersBox match {
        case Full(dataLayers) if (dataLayers.length > 0) =>
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
      datastore <- DataStoreSQLDAO.findOneByName(s._dataStore.trim)(GlobalAccessContext) ?~> Messages("datastore.notFound")
      allowedTeams <- DataSetAllowedTeamsSQLDAO.findAllForDataSet(s._id)(GlobalAccessContext) ?~> Messages("allowedTeams.notFound")
      allowedTeamsBson <- Fox.combined(allowedTeams.map(ObjectId(_).toBSONObjectId.toFox))
      defaultConfiguration <- parseDefaultConfiguration(s.defaultConfiguration)
      organization <- OrganizationSQLDAO.findOne(s._organization)(GlobalAccessContext) ?~> Messages("team.notFound")
      dataSource <- constructDataSource(s, organization)(GlobalAccessContext) ?~> "could not construct datasource"
    } yield {
      DataSet(
        DataStoreInfo(datastore.name, datastore.url, datastore.typ),
        dataSource,
        organization.name,
        allowedTeamsBson,
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

  def findOneBySourceName(name: String)(implicit ctx: DBAccessContext): Fox[DataSet] = {
    for {
      dataSetSQL <- DataSetSQLDAO.findOneByName(name)
      dataSet <- DataSet.fromDataSetSQL(dataSetSQL)
    } yield dataSet
  }

  def findAll(implicit ctx: DBAccessContext): Fox[List[DataSet]] =
    for {
      dataSetsSQL <- DataSetSQLDAO.findAll
      dataSets <- Fox.combined(dataSetsSQL.map(DataSet.fromDataSetSQL(_)))
    } yield dataSets

  def updateDataSource(
                        name: String,
                        dataStoreInfo: DataStoreInfo,
                        source: InboxDataSource,
                        isActive: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    DataSetSQLDAO.updateDataSourceByName(name, dataStoreInfo.name, source, isActive)

  def updateTeams(name: String, teams: List[BSONObjectID])(implicit ctx: DBAccessContext) =
    DataSetAllowedTeamsSQLDAO.updateAllowedTeamsForDataSetByName(name, teams.map(ObjectId.fromBsonId(_)))

  def update(name: String, description: Option[String], isPublic: Boolean)(implicit ctx: DBAccessContext): Fox[DataSet] = {
    for {
      _ <- DataSetSQLDAO.updateFieldsByName(name, description, isPublic)
      updated <- findOneBySourceName(name)
    } yield updated
  }

  def insert(dataSet: DataSet)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val newId = ObjectId.generate
    for {
      dataSetSQL <- DataSetSQL.fromDataSetWithId(dataSet, newId)
      _ <- DataSetSQLDAO.insertOne(dataSetSQL)
      _ <- DataSetDataLayerSQLDAO.updateLayers(newId, dataSet.dataSource)
      _ <- DataSetAllowedTeamsSQLDAO.updateAllowedTeamsForDataSetByName(dataSet.name, dataSet.allowedTeams.map(ObjectId.fromBsonId(_)))
    } yield ()
  }

  def countAll(implicit ctx: DBAccessContext): Fox[Int] = DataSetSQLDAO.countAll

  def deactivateUnreportedDataSources(dataStoreName: String, dataSources: List[InboxDataSource])(implicit ctx: DBAccessContext): Fox[Unit] =
    DataSetSQLDAO.deactivateUnreported(dataSources.map(_.id.name), dataStoreName)
}
