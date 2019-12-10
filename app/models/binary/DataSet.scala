package models.binary

import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{
  UnusableDataSource,
  InboxDataSourceLike => InboxDataSource
}
import com.scalableminds.webknossos.datastore.models.datasource.{
  AbstractDataLayer,
  AbstractSegmentationLayer,
  Category,
  DataSourceId,
  ElementClass,
  GenericDataSource,
  DataLayerLike => DataLayer
}
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import models.configuration.DataSetConfiguration
import models.team._
import play.api.i18n.Messages
import play.api.libs.json._
import play.utils.UriEncoding
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import slick.sql
import utils.{ObjectId, SQLClient, SQLDAO, SimpleSQLDAO}

import scala.concurrent.ExecutionContext

case class DataSet(
    _id: ObjectId,
    _dataStore: String,
    _organization: ObjectId,
    _publication: Option[ObjectId],
    inboxSourceHash: Option[Int],
    defaultConfiguration: Option[DataSetConfiguration] = None,
    description: Option[String] = None,
    displayName: Option[String] = None,
    isPublic: Boolean,
    isUsable: Boolean,
    name: String,
    scale: Option[Scale],
    sharingToken: Option[String],
    status: String,
    logoUrl: Option[String],
    sortingKey: Long = System.currentTimeMillis(),
    details: Option[JsObject] = None,
    created: Long = System.currentTimeMillis(),
    isDeleted: Boolean = false
) extends FoxImplicits {

  def urlEncodedName: String =
    UriEncoding.encodePathSegment(name, "UTF-8")
}

class DataSetDAO @Inject()(sqlClient: SQLClient,
                           dataSetDataLayerDAO: DataSetDataLayerDAO,
                           organizationDAO: OrganizationDAO)(implicit ec: ExecutionContext)
    extends SQLDAO[DataSet, DatasetsRow, Datasets](sqlClient) {
  val collection = Datasets

  def idColumn(x: Datasets): Rep[String] = x._Id

  def isDeletedColumn(x: Datasets): Rep[Boolean] = x.isdeleted

  private def parseScaleOpt(literalOpt: Option[String]): Fox[Option[Scale]] = literalOpt match {
    case Some(literal) =>
      for {
        scale <- Scale.fromList(parseArrayTuple(literal).map(_.toFloat)) ?~> "could not parse edit position"
      } yield Some(scale)
    case None => Fox.successful(None)
  }

  private def writeScaleLiteral(scale: Scale): String =
    writeStructTuple(List(scale.x, scale.y, scale.z).map(_.toString))

  def parse(r: DatasetsRow): Fox[DataSet] =
    for {
      scale <- parseScaleOpt(r.scale)
      defaultConfigurationOpt <- Fox.runOptional(r.defaultconfiguration)(
        JsonHelper.parseJsonToFox[DataSetConfiguration](_))
      details <- Fox.runOptional(r.details)(JsonHelper.parseJsonToFox[JsObject](_))
    } yield {
      DataSet(
        ObjectId(r._Id),
        r._Datastore.trim,
        ObjectId(r._Organization),
        r._Publication.map(ObjectId(_)),
        r.inboxsourcehash,
        defaultConfigurationOpt,
        r.description,
        r.displayname,
        r.ispublic,
        r.isusable,
        r.name,
        scale,
        r.sharingtoken,
        r.status,
        r.logourl,
        r.sortingkey.getTime,
        details,
        r.created.getTime,
        r.isdeleted
      )
    }

  override def anonymousReadAccessQ(sharingToken: Option[String]) =
    "isPublic" + sharingToken.map(t => s" or sharingToken = '$t'").getOrElse("")

  override def readAccessQ(requestingUserId: ObjectId) =
    s"""isPublic
        or _organization in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin)
        or _id in (select _dataSet
          from (webknossos.dataSet_allowedTeams dt join (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}') ut on dt._team = ut._team))
        or ('${requestingUserId.id}' in (select _user from webknossos.user_team_roles where isTeammanager)
            and _organization in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}'))"""

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[DataSet] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #${columns} from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}"
          .as[DatasetsRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  override def findAll(implicit ctx: DBAccessContext): Fox[List[DataSet]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"select #${columns} from #${existingCollectionName} where #${accessQuery}".as[DatasetsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def isEmpty(implicit ctx: DBAccessContext): Fox[Boolean] =
    for {
      r <- run(sql"select count(*) from #${existingCollectionName} limit 1".as[Int])
      firstRow <- r.headOption
    } yield firstRow == 0

  def countAllForOrganization(organizationId: ObjectId)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      rList <- run(
        sql"select count(_id) from #${existingCollectionName} where _organization = ${organizationId}".as[Int])
      r <- rList.headOption
    } yield r

  def findOneByNameAndOrganizationName(name: String, organizationName: String)(
      implicit ctx: DBAccessContext): Fox[DataSet] =
    for {
      organization <- organizationDAO.findOneByName(organizationName)(GlobalAccessContext) ?~> ("organization.notFound " + organizationName)
      dataset <- findOneByNameAndOrganization(name, organization._id)
    } yield dataset

  def findOneByNameAndOrganization(name: String, organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[DataSet] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #${columns} from #${existingCollectionName} where name = ${name} and _organization = ${organizationId} and #${accessQuery}"
          .as[DatasetsRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield parsed

  def findAllByNamesAndOrganization(names: List[String], organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[List[DataSet]] =
    for {
      accessQuery <- readAccessQuery
      rows <- run(sql"select #${columns} from #${existingCollectionName} where name in #${writeStructTupleWithQuotes(
        names.map(sanitize))} and _organization = ${organizationId} and #${accessQuery}".as[DatasetsRow]).map(_.toList)
      parsed <- Fox.combined(rows.map(parse))
    } yield parsed

  /* Disambiguation method for legacy URLs and NMLs: if the user has access to multiple datasets of the same name, use the oldest.
   * This is reasonable, because the legacy URL/NML was likely created before this ambiguity became possible */
  def getOrganizationForDataSet(dataSetName: String)(implicit ctx: DBAccessContext): Fox[ObjectId] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select _organization from #${existingCollectionName} where name = ${dataSetName} and #${accessQuery} order by created asc"
          .as[String])
      r <- rList.headOption.toFox
      parsed <- ObjectId.parse(r)
    } yield parsed

  def getIdByName(name: String)(implicit ctx: DBAccessContext): Fox[ObjectId] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select _id from #${existingCollectionName} where name = ${name} and #${accessQuery}".as[String])
      r <- rList.headOption.toFox
    } yield ObjectId(r)

  def getNameById(id: ObjectId)(implicit ctx: DBAccessContext): Fox[String] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select name from #${existingCollectionName} where _id = ${id} and #${accessQuery}".as[String])
      r <- rList.headOption.toFox
    } yield r

  def getSharingTokenByName(name: String, organizationId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[Option[String]] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select sharingToken from webknossos.datasets_ where name = ${name} and _organization = ${organizationId} and #${accessQuery}"
          .as[Option[String]])
      r <- rList.headOption.toFox
    } yield {
      r
    }

  def updateSharingTokenByName(name: String, organizationId: ObjectId, sharingToken: Option[String])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      accessQuery <- readAccessQuery
      _ <- run(
        sqlu"update webknossos.datasets_ set sharingToken = ${sharingToken} where name = ${name} and _organization = ${organizationId} and #${accessQuery}")
    } yield ()

  def updateFields(_id: ObjectId,
                   description: Option[String],
                   displayName: Option[String],
                   sortingKey: Long,
                   isPublic: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- Datasets if notdel(row) && row._Id === _id.id } yield
      (row.description, row.displayname, row.sortingkey, row.ispublic)
    for {
      _ <- run(q.update(description, displayName, new java.sql.Timestamp(sortingKey), isPublic))
    } yield ()
  }

  def updateDefaultConfigurationByName(name: String, configuration: DataSetConfiguration)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- run(sqlu"""update webknossos.dataSets
                      set defaultConfiguration = '#${sanitize(Json.toJson(configuration).toString)}'
                      where name = ${name}""")
    } yield ()

  def insertOne(d: DataSet)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val defaultConfiguration: Option[String] = d.defaultConfiguration.map(c => Json.toJson(c.configuration).toString)
    val details: Option[String] = d.details.map(_.toString)
    for {
      _ <- run(
        sqlu"""insert into webknossos.dataSets(_id, _dataStore, _organization, _publication, inboxSourceHash, defaultConfiguration, description, displayName,
                                                             isPublic, isUsable, name, scale, status, sharingToken, sortingKey, details, created, isDeleted)
               values(${d._id.id}, ${d._dataStore}, ${d._organization.id}, #${optionLiteral(d._publication.map(_.id))},
                #${optionLiteral(d.inboxSourceHash.map(_.toString))}, #${optionLiteral(
          defaultConfiguration.map(sanitize))},
                ${d.description}, ${d.displayName}, ${d.isPublic}, ${d.isUsable},
                      ${d.name}, #${optionLiteral(d.scale.map(s => writeScaleLiteral(s)))}, ${d.status
          .take(1024)}, ${d.sharingToken}, ${new java.sql.Timestamp(d.sortingKey)}, #${optionLiteral(
          details.map(sanitize))}, ${new java.sql.Timestamp(d.created)}, ${d.isDeleted})
            """)
    } yield ()
  }

  def updateDataSourceByNameAndOrganizationName(id: ObjectId,
                                                dataStoreName: String,
                                                inboxSourceHash: Int,
                                                source: InboxDataSource,
                                                isUsable: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      organization <- organizationDAO.findOneByName(source.id.team)
      q = sqlu"""update webknossos.dataSets
                    set _dataStore = ${dataStoreName},
                        _organization = ${organization._id.id},
                        inboxSourceHash = #${optionLiteral(Some(inboxSourceHash.toString))},
                        isUsable = ${isUsable},
                        scale = #${optionLiteral(source.scaleOpt.map(s => writeScaleLiteral(s)))},
                        status = ${source.statusOpt.getOrElse("").take(1024)}
                   where _id = ${id}"""
      _ <- run(q)
      _ <- dataSetDataLayerDAO.updateLayers(id, source)
    } yield ()

  def deactivateUnreported(names: List[String],
                           organizationId: ObjectId,
                           dataStoreName: String,
                           unreportedStatus: String): Fox[Unit] = {
    val inclusionPredicate =
      if (names.isEmpty) "true" else s"name not in ${writeStructTupleWithQuotes(names.map(sanitize))}"
    val deleteResolutionsQuery =
      sqlu"""delete from webknossos.dataSet_resolutions where _dataSet in
            (select _id from webknossos.dataSets where _dataStore = ${dataStoreName} and _organization = ${organizationId}
             and #${inclusionPredicate})"""
    val deleteLayersQuery =
      sqlu"""delete from webknossos.dataSet_layers where _dataSet in
            (select _id from webknossos.dataSets where _dataStore = ${dataStoreName} and _organization = ${organizationId}
             and #${inclusionPredicate})"""
    val setToUnusableQuery =
      sqlu"""update webknossos.datasets
             set isUsable = false, status = $unreportedStatus, scale = NULL, inboxSourceHash = NULL
             where _dataStore = ${dataStoreName} and _organization = ${organizationId}
             and #${inclusionPredicate}"""
    for {
      _ <- run(DBIO.sequence(List(deleteResolutionsQuery, deleteLayersQuery, setToUnusableQuery)).transactionally)
    } yield ()
  }

}

class DataSetResolutionsDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def parseRow(row: DatasetResolutionsRow): Fox[Point3D] =
    for {
      resolution <- Point3D.fromList(parseArrayTuple(row.resolution).map(_.toInt)) ?~> "could not parse resolution"
    } yield resolution

  def findDataResolutionForLayer(dataSetId: ObjectId, dataLayerName: String): Fox[List[Point3D]] =
    for {
      rows <- run(
        DatasetResolutions.filter(r => r._Dataset === dataSetId.id && r.datalayername === dataLayerName).result)
        .map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow)) ?~> "could not parse resolution row"
    } yield {
      rowsParsed
    }

  def updateResolutions(_dataSet: ObjectId, dataLayersOpt: Option[List[DataLayer]]): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.dataSet_resolutions where _dataSet = ${_dataSet.id}"
    val insertQueries = dataLayersOpt match {
      case Some(dataLayers: List[DataLayer]) => {
        dataLayers.map { layer =>
          layer.resolutions.map { resolution =>
            {
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

class DataSetDataLayerDAO @Inject()(sqlClient: SQLClient, dataSetResolutionsDAO: DataSetResolutionsDAO)(
    implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def parseRow(row: DatasetLayersRow, dataSetId: ObjectId, skipResolutions: Boolean = false): Fox[DataLayer] = {
    val result: Fox[Fox[DataLayer]] = for {
      category <- Category.fromString(row.category).toFox ?~> "Could not parse Layer Category"
      boundingBox <- BoundingBox
        .fromSQL(parseArrayTuple(row.boundingbox).map(_.toInt))
        .toFox ?~> "Could not parse boundingbox"
      elementClass <- ElementClass.fromString(row.elementclass).toFox ?~> "Could not parse Layer ElementClass"
      standinResolutions: Option[List[Point3D]] = if (skipResolutions) Some(List.empty) else None
      resolutions <- Fox.fillOption(standinResolutions)(
        dataSetResolutionsDAO.findDataResolutionForLayer(dataSetId, row.name) ?~> "Could not find resolution for layer")
    } yield {
      (row.largestsegmentid, row.mappings) match {
        case (Some(segmentId), Some(mappings)) =>
          Fox.successful(
            AbstractSegmentationLayer(
              row.name,
              category,
              boundingBox,
              resolutions.sortBy(_.maxDim),
              elementClass,
              segmentId,
              parseArrayTuple(mappings).toSet
            ))
        case (None, None) =>
          Fox.successful(
            AbstractDataLayer(
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

  def findAllForDataSet(dataSetId: ObjectId, skipResolutions: Boolean = false)(
      implicit ctx: DBAccessContext): Fox[List[DataLayer]] =
    for {
      rows <- run(DatasetLayers.filter(_._Dataset === dataSetId.id).result).map(_.toList)
      rowsParsed <- Fox.combined(rows.map(parseRow(_, dataSetId, skipResolutions)))
    } yield {
      rowsParsed
    }

  def findOneByNameForDataSet(dataLayerName: String, dataSetId: ObjectId)(
      implicit ctx: DBAccessContext): Fox[DataLayer] =
    for {
      rows <- run(DatasetLayers.filter(_._Dataset === dataSetId.id).filter(_.name === dataLayerName).result)
        .map(_.toList)
      firstRow <- rows.headOption.toFox ?~> ("Could not find data layer " + dataLayerName)
      parsed <- parseRow(firstRow, dataSetId)
    } yield {
      parsed
    }

  def insertLayerQuery(_dataSet: ObjectId, layer: DataLayer) =
    layer match {
      case s: AbstractSegmentationLayer => {
        sqlu"""insert into webknossos.dataset_layers(_dataSet, name, category, elementClass, boundingBox, largestSegmentId, mappings)
                    values(${_dataSet.id}, ${s.name}, '#${s.category.toString}', '#${s.elementClass.toString}',
                     '#${writeStructTuple(s.boundingBox.toSql.map(_.toString))}', ${s.largestSegmentId}, '#${writeArrayTuple(
          s.mappings.map(sanitize(_)).toList)}')"""
      }
      case d: AbstractDataLayer => {
        sqlu"""insert into webknossos.dataset_layers(_dataSet, name, category, elementClass, boundingBox)
                    values(${_dataSet.id}, ${d.name}, '#${d.category.toString}', '#${d.elementClass.toString}',
                     '#${writeStructTuple(d.boundingBox.toSql.map(_.toString))}')"""
      }
      case _ => throw new Exception("DataLayer type mismatch")
    }

  def updateLayers(_dataSet: ObjectId, source: InboxDataSource)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery =
      sqlu"delete from webknossos.dataset_layers where _dataSet = (select _id from webknossos.dataSets where _id = ${_dataSet.id})"
    val insertQueries = source.toUsable match {
      case Some(usable) => usable.dataLayers.map(insertLayerQuery(_dataSet, _))
      case None         => List()
    }
    for {
      _ <- run(DBIO.sequence(List(clearQuery) ++ insertQueries))
      _ <- dataSetResolutionsDAO.updateResolutions(_dataSet, source.toUsable.map(_.dataLayers))
    } yield ()
  }
}

class DataSetAllowedTeamsDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findAllForDataSet(dataSetId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[ObjectId]] = {
    val query = for {
      (allowedteam, team) <- DatasetAllowedteams.filter(_._Dataset === dataSetId.id) join Teams on (_._Team === _._Id)
    } yield team._Id

    run(query.result).flatMap(rows => Fox.serialCombined(rows.toList)(ObjectId.parse(_)))
  }

  def updateAllowedTeamsForDataSet(_id: ObjectId, allowedTeams: List[ObjectId])(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.dataSet_allowedTeams where _dataSet = ${_id}"

    val insertQueries = allowedTeams.map(teamId => sqlu"""insert into webknossos.dataSet_allowedTeams(_dataSet, _team)
                                                              values(${_id}, ${teamId.id})""")

    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
    for {
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }
}

class DataSetLastUsedTimesDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  def findForDataSetAndUser(dataSetId: ObjectId, userId: ObjectId): Fox[Long] =
    for {
      rList <- run(
        sql"select lastUsedTime from webknossos.dataSet_lastUsedTimes where _dataSet = ${dataSetId} and _user = ${userId}"
          .as[java.sql.Timestamp])
      r <- rList.headOption.toFox
    } yield (r.getTime)

  def updateForDataSetAndUser(dataSetId: ObjectId, userId: ObjectId): Fox[Unit] = {
    val clearQuery =
      sqlu"delete from webknossos.dataSet_lastUsedTimes where _dataSet = ${dataSetId} and _user = ${userId}"
    val insertQuery =
      sqlu"insert into webknossos.dataSet_lastUsedTimes(_dataSet, _user, lastUsedTime) values(${dataSetId}, ${userId}, NOW())"
    val composedQuery = DBIO.sequence(List(clearQuery, insertQuery))
    for {
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }
}
