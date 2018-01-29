package models.binary

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{UnusableDataSource, InboxDataSourceLike => InboxDataSource}
import com.scalableminds.webknossos.datastore.models.datasource.{AbstractDataLayer, AbstractSegmentationLayer, Category, DataResolution, DataSourceId, ElementClass, GenericDataSource, DataLayerLike => DataLayer}
import com.scalableminds.webknossos.schema.Tables._
import models.configuration.DataSetConfiguration
import models.team.{TeamSQL, TeamSQLDAO}
import models.user.User
import net.liftweb.common.Full
import play.api.Play.current
import play.api.i18n.Messages
import play.api.i18n.Messages.Implicits._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.utils.UriEncoding
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLDAO, SimpleSQLDAO}


case class DataSetSQL(
                       _id: ObjectId,
                       _dataStore: String,
                       _team: ObjectId,
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
      team <- TeamSQLDAO.findOneByName(d.dataSource.id.team)
    } yield {
      DataSetSQL(
        newId,
        d.dataStoreInfo.name,
        team._id,
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

  def parse(r: DatasetsRow): Fox[DataSetSQL] = {
    for {
      scale <- parseScaleOpt(r.scale)
    } yield {
      DataSetSQL(
        ObjectId(r._Id),
        r._Datastore,
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

  def insertOne(d: DataSetSQL)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      _ <- run(sqlu"""insert overwrite into webknossos.dataSets(_id, _dataStore, _team, defaultConfiguration, description, isPublic, isUsable, name, scale, status, created, isDeleted)
               values(${d._id.id}, ${d._dataStore}, ${d._team.id}, #${optionLiteral(d.defaultConfiguration.map(_.toString).map(sanitize))}, ${d.description}, ${d.isPublic}, ${d.isUsable},
                      ${d.name}, #${optionLiteral(d.scale.map(s => writeScaleLiteral(s)))}, ${d.status}, ${new java.sql.Timestamp(d.created)}, ${d.isDeleted})
            """)
    } yield ()
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
                        status = ${source.statusOpt.getOrElse("")}
                   where _id = ${old._id.id}"""
      _ <- run(q)
      _ <- DataSetDataLayerSQLDAO.updateLayers(old._id, source)
    } yield ()
  }

  def deactivateUnreported(names: List[String], dataStoreName: String): Fox[Unit] = {
    val q = for {row <- Datasets if (notdel(row) && row.name.inSetBind(names) && row._Datastore === dataStoreName) } yield (row.isusable, row.status)
    for { _ <-run(q.update(false, "No longer available on datastore.")) } yield ()
  }

  private def writeScaleLiteral(scale: Scale): String =
    writeStructTuple(List(scale.x, scale.y, scale.z).map(_.toString))
}


object DataSetResolutionsSQLDAO extends SimpleSQLDAO {

  def parseRow(row: DatasetResolutionsRow): Fox[DataResolution] = {
    for {
      scale <- Point3D.fromList(parseArrayTuple(row.scale).map(_.toInt)) ?~> "could not parse scale"
    } yield {
      DataResolution(row.resolution, scale)
    }
  }

  def findDataResolutionForLayer(dataSetId: ObjectId, dataLayerName: String): Fox[List[DataResolution]] = {
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
            sqlu"""insert into webknossos.dataSet_resolutions(_dataSet, dataLayerName, resolution, scale)
                       values(${_dataSet.id}, ${layer.name}, ${resolution.resolution}, '#${writeStructTuple(resolution.scale.toList.map(_.toString))}')"""
          }}
        }.flatten
      }
      case _ => List()
    }
    for {
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries))
    } yield ()
  }

}


object DataSetDataLayerSQLDAO extends SimpleSQLDAO {

  def parseRow(row: DatasetLayersRow, dataSetId: ObjectId): Fox[DataLayer] = {
    val result: Fox[Fox[DataLayer]] = for {
      category <- Category.fromString(row.category).toFox ?~> "Could not parse Layer Category"
      boundingBox <- BoundingBox.fromSQL(parseArrayTuple(row.boundingbox).map(_.toInt)).toFox  ?~> "Could not parse boundingbox"
      elementClass <- ElementClass.fromString(row.elementclass).toFox ?~> "Could not parse Layer ElementClass"
      resolutions <- DataSetResolutionsSQLDAO.findDataResolutionForLayer(dataSetId, row.name)  ?~> "Could not find resolution for layer"
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
        case _ => Fox.failure("Could not match Dataset Layer")
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

  private def constructDataSource(s: DataSetSQL, team: TeamSQL)(implicit ctx: DBAccessContext): Fox[InboxDataSource] = {
    val dataSourceId = DataSourceId(s.name, team.name)
    for {
      dataLayersBox <- (DataSetDataLayerSQLDAO.findDataLayersForDataSet(s._id) ?~> "could not find data layers" ).futureBox
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
      datastore <- DataStoreSQLDAO.findOneByName(s._dataStore.trim) ?~> Messages("datastore.notFound")
      allowedTeams <- DataSetAllowedTeamsSQLDAO.findAllowedTeamsForDataSet(s._id) ?~> Messages("allowedTeams.notFound")
      defaultConfiguration <- parseDefaultConfiguration(s.defaultConfiguration)
      team <- TeamSQLDAO.findOne(s._team) ?~> Messages("team.notFound")
      dataSource <- constructDataSource(s, team) ?~> "could not construct datasource"
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

  def updateTeams(name: String, teams: List[String])(implicit ctx: DBAccessContext) =
    DataSetAllowedTeamsSQLDAO.updateAllowedTeamsForDataSetByName(name, teams)

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
      _ <- DataSetAllowedTeamsSQLDAO.updateAllowedTeamsForDataSetByName(dataSet.name, dataSet.allowedTeams)
    } yield ()
  }

  def count(implicit ctx: DBAccessContext): Fox[Int] = DataSetSQLDAO.countAll

  def deactivateUnreportedDataSources(dataStoreName: String, dataSources: List[InboxDataSource])(implicit ctx: DBAccessContext): Fox[Unit] =
    DataSetSQLDAO.deactivateUnreported(dataSources.map(_.id.name), dataStoreName)

}
