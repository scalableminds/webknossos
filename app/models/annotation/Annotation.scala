package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayer, AnnotationLayerType}
import com.scalableminds.webknossos.schema.Tables._
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import play.api.libs.json._
import slick.jdbc.GetResult
import slick.jdbc.GetResult._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import slick.sql.SqlAction
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SimpleSQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

object AnnotationDefaults {
  val defaultName: String = ""
  val defaultDescription: String = ""
}

case class Annotation(
    _id: ObjectId,
    _dataset: ObjectId,
    _task: Option[ObjectId] = None,
    _team: ObjectId,
    _user: ObjectId,
    annotationLayers: List[AnnotationLayer],
    description: String = AnnotationDefaults.defaultDescription,
    visibility: AnnotationVisibility.Value = AnnotationVisibility.Internal,
    name: String = AnnotationDefaults.defaultName,
    viewConfiguration: Option[JsObject] = None,
    state: AnnotationState.Value = Active,
    isLockedByOwner: Boolean = false,
    tags: Set[String] = Set.empty,
    tracingTime: Option[Long] = None,
    typ: AnnotationType.Value = AnnotationType.Explorational,
    othersMayEdit: Boolean = false,
    created: Instant = Instant.now,
    modified: Instant = Instant.now,
    isDeleted: Boolean = false
) extends FoxImplicits {

  def nameOpt: Option[String] = if (name.isEmpty) None else Some(name)

  lazy val id: String = _id.toString

  def tracingType: TracingType.Value = {
    val skeletonPresent = annotationLayers.exists(_.typ == AnnotationLayerType.Skeleton)
    val volumePresent = annotationLayers.exists(_.typ == AnnotationLayerType.Volume)
    if (skeletonPresent && volumePresent) TracingType.hybrid
    else if (skeletonPresent) TracingType.skeleton
    else TracingType.volume
  }

  def skeletonTracingId(implicit ec: ExecutionContext): Fox[Option[String]] =
    for {
      _ <- Fox.fromBool(annotationLayers.count(_.typ == AnnotationLayerType.Skeleton) <= 1) ?~> "annotation.multiLayers.skeleton.notImplemented"
    } yield annotationLayers.find(_.typ == AnnotationLayerType.Skeleton).map(_.tracingId)

  def volumeTracingId(implicit ec: ExecutionContext): Fox[Option[String]] =
    for {
      _ <- Fox.fromBool(annotationLayers.count(_.typ == AnnotationLayerType.Volume) <= 1) ?~> "annotation.multiLayers.volume.notImplemented"
    } yield annotationLayers.find(_.typ == AnnotationLayerType.Volume).map(_.tracingId)

  def volumeAnnotationLayers: List[AnnotationLayer] = annotationLayers.filter(_.typ == AnnotationLayerType.Volume)

  def skeletonAnnotationLayers: List[AnnotationLayer] = annotationLayers.filter(_.typ == AnnotationLayerType.Skeleton)

}

case class AnnotationCompactInfo(id: ObjectId,
                                 typ: AnnotationType.Value,
                                 name: String,
                                 description: String,
                                 ownerId: ObjectId,
                                 ownerFirstName: String,
                                 ownerLastName: String,
                                 othersMayEdit: Boolean,
                                 teamIds: Seq[ObjectId],
                                 teamNames: Seq[String],
                                 teamOrganizationIds: Seq[String],
                                 modified: Instant,
                                 tags: Set[String],
                                 state: AnnotationState.Value = Active,
                                 isLockedByOwner: Boolean,
                                 dataSetName: String,
                                 visibility: AnnotationVisibility.Value = AnnotationVisibility.Internal,
                                 tracingTime: Option[Long] = None,
                                 organization: String,
                                 tracingIds: Seq[String],
                                 annotationLayerNames: Seq[String],
                                 annotationLayerTypes: Seq[String],
                                 annotationLayerStatistics: Seq[JsObject])

class AnnotationLayerDAO @Inject()(SQLClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(SQLClient) {

  private def parse(r: AnnotationLayersRow): Fox[AnnotationLayer] =
    for {
      typ <- AnnotationLayerType.fromString(r.typ)
    } yield {
      AnnotationLayer(
        r.tracingid,
        typ,
        r.name,
        Json.parse(r.statistics).as[JsObject],
      )
    }

  def findAnnotationLayersFor(annotationId: ObjectId): Fox[List[AnnotationLayer]] =
    for {
      rows <- run(q"""SELECT _annotation, tracingId, typ, name, statistics
                      FROM webknossos.annotation_layers
                      WHERE _annotation = $annotationId
                      ORDER BY tracingId""".as[AnnotationLayersRow])
      parsed <- Fox.serialCombined(rows.toList)(parse)
    } yield parsed

  def insertForAnnotation(annotationId: ObjectId, annotationLayers: List[AnnotationLayer]): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(annotationLayers)(insertOne(annotationId, _))
    } yield ()

  def insertOne(annotationId: ObjectId, annotationLayer: AnnotationLayer): Fox[Unit] =
    for {
      _ <- run(insertOneQuery(annotationId, annotationLayer))
    } yield ()

  def insertLayerQueries(annotationId: ObjectId,
                         layers: List[AnnotationLayer]): List[SqlAction[Int, NoStream, Effect]] =
    layers.map { annotationLayer =>
      insertOneQuery(annotationId, annotationLayer)
    }

  private def insertOneQuery(annotationId: ObjectId, a: AnnotationLayer): SqlAction[Int, NoStream, Effect] =
    q"""INSERT INTO webknossos.annotation_layers(_annotation, tracingId, typ, name, statistics)
          VALUES($annotationId, ${a.tracingId}, ${a.typ}, ${a.name}, ${a.stats})""".asUpdate

  def deleteOneByName(annotationId: ObjectId, layerName: String): Fox[Unit] =
    for {
      _ <- run(q"""DELETE FROM webknossos.annotation_layers
                   WHERE _annotation = $annotationId
                   AND name = $layerName""".asUpdate)
    } yield ()

  def deleteOneByTracingId(annotationId: ObjectId, tracingId: String): Fox[Unit] =
    for {
      _ <- run(q"""DELETE FROM webknossos.annotation_layers
                   WHERE _annotation = $annotationId
                   AND tracingId = $tracingId""".asUpdate)
    } yield ()

  def findAnnotationIdByTracingId(tracingId: String): Fox[ObjectId] =
    for {
      rList <- run(q"SELECT _annotation FROM webknossos.annotation_layers WHERE tracingId = $tracingId".as[ObjectId])
      head <- rList.headOption.toFox
    } yield head

  def findAllVolumeLayers: Fox[List[AnnotationLayer]] =
    for {
      rows <- run(q"""SELECT _annotation, tracingId, typ, name, statistics
                      FROM webknossos.annotation_layers
                      WHERE typ = 'Volume'""".as[AnnotationLayersRow])
      parsed <- Fox.serialCombined(rows.toList)(parse)
    } yield parsed

  def replaceTracingId(annotationId: ObjectId, oldTracingId: String, newTracingId: String): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.annotation_layers
                   SET tracingId = $newTracingId
                   WHERE _annotation = $annotationId
                   AND tracingId = $oldTracingId""".asUpdate)
    } yield ()

  def updateName(annotationId: ObjectId, tracingId: String, newName: String): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.annotation_layers
                   SET name = $newName
                   WHERE _annotation = $annotationId
                   AND tracingId = $tracingId""".asUpdate)
    } yield ()

  def deleteAllForAnnotationQuery(annotationId: ObjectId): SqlAction[Int, NoStream, Effect] =
    q"DELETE FROM webknossos.annotation_layers WHERE _annotation = $annotationId".asUpdate

  def updateStatistics(annotationId: ObjectId, tracingId: String, statistics: JsValue): Fox[Unit] =
    for {
      _ <- run(q"""UPDATE webknossos.annotation_layers
                   SET statistics = $statistics
                   WHERE _annotation = $annotationId
                   AND tracingId = $tracingId""".asUpdate)
    } yield ()
}

class AnnotationDAO @Inject()(sqlClient: SqlClient, annotationLayerDAO: AnnotationLayerDAO)(
    implicit ec: ExecutionContext)
    extends SQLDAO[Annotation, AnnotationsRow, Annotations](sqlClient) {
  protected val collection = Annotations

  protected def idColumn(x: Annotations): Rep[String] = x._Id
  protected def isDeletedColumn(x: Annotations): Rep[Boolean] = x.isdeleted

  protected def parse(r: AnnotationsRow): Fox[Annotation] =
    for {
      state <- AnnotationState.fromString(r.state).toFox
      typ <- AnnotationType.fromString(r.typ).toFox
      viewconfigurationOpt <- Fox.runOptional(r.viewconfiguration)(JsonHelper.parseAndValidateJson[JsObject](_))
      visibility <- AnnotationVisibility.fromString(r.visibility).toFox
      annotationLayers <- annotationLayerDAO.findAnnotationLayersFor(ObjectId(r._Id))
    } yield {
      Annotation(
        ObjectId(r._Id),
        ObjectId(r._Dataset),
        r._Task.map(ObjectId(_)),
        ObjectId(r._Team),
        ObjectId(r._User),
        annotationLayers,
        r.description,
        visibility,
        r.name,
        viewconfigurationOpt,
        state,
        r.islockedbyowner,
        parseArrayLiteral(r.tags).toSet,
        r.tracingtime,
        typ,
        r.othersmayedit,
        Instant.fromSql(r.created),
        Instant.fromSql(r.modified),
        r.isdeleted
      )
    }

  override protected def anonymousReadAccessQ(sharingToken: Option[String]) =
    q"visibility = ${AnnotationVisibility.Public}"

  private def listAccessQ(requestingUserId: ObjectId, prefix: SqlToken): SqlToken =
    q"""
        (
          _user = $requestingUserId
          OR (
            (${prefix}visibility = ${AnnotationVisibility.Public} or ${prefix}visibility = ${AnnotationVisibility.Internal})
            AND (
              ${prefix}_id IN (
                SELECT DISTINCT a._annotation
                FROM webknossos.annotation_sharedTeams a
                JOIN webknossos.user_team_roles t ON a._team = t._team
                WHERE t._user = $requestingUserId
              )
              OR
              ${prefix}_id IN (
                SELECT _annotation
                FROM webknossos.annotation_contributors
                WHERE _user = $requestingUserId
              )
            )
          )
        )
       """

  private def baseListAccessQ(implicit ctx: DBAccessContext): Fox[SqlToken] =
    accessQueryFromAccessQWithPrefix(listAccessQ, q"")(ctx)

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    readAccessQWithPrefix(requestingUserId, q"")

  protected def readAccessQWithPrefix(requestingUserId: ObjectId, prefix: SqlToken): SqlToken =
    q"""${prefix}visibility = ${AnnotationVisibility.Public}
        OR (
          ${prefix}visibility = ${AnnotationVisibility.Internal}
          AND (
            (SELECT _organization FROM webknossos.teams WHERE webknossos.teams._id = ${prefix}_team)
            IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId)
          )
          OR ${prefix}_team IN (SELECT _team FROM webknossos.user_team_roles WHERE _user = $requestingUserId AND isTeamManager)
          OR ${prefix}_user = $requestingUserId
          OR (
            (SELECT _organization FROM webknossos.teams WHERE webknossos.teams._id = ${prefix}_team)
            IN (SELECT _organization FROM webknossos.users_ where _id = $requestingUserId AND isAdmin)
          )
        )"""

  override protected def deleteAccessQ(requestingUserId: ObjectId) =
    q"""(_team IN (SELECT _team FROM webknossos.user_team_roles WHERE isTeamManager AND _user = $requestingUserId) OR _user = $requestingUserId
       OR (SELECT _organization FROM webknossos.teams WHERE webknossos.teams._id = _team)
        IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId AND isAdmin))"""

  override protected def updateAccessQ(requestingUserId: ObjectId): SqlToken =
    deleteAccessQ(requestingUserId)

  // read operations

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[AnnotationsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  private def getStateQuery(isFinished: Option[Boolean]) =
    isFinished match {
      case Some(true)  => q"state = ${AnnotationState.Finished}"
      case Some(false) => q"state = ${AnnotationState.Active}"
      case None        => q"state != ${AnnotationState.Cancelled}"
    }

  def findAllFor(userId: ObjectId,
                 isFinished: Option[Boolean],
                 annotationType: AnnotationType,
                 limit: Int,
                 pageNumber: Int = 0)(implicit ctx: DBAccessContext): Fox[List[Annotation]] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE _user = $userId
                   AND typ = $annotationType
                   AND $stateQuery
                   AND $accessQuery
                   ORDER BY _id DESC
                   LIMIT $limit
                   OFFSET ${pageNumber * limit}""".as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed
  }

  // Necessary since a tuple can only have 22 elements
  implicit def GetResultAnnotationCompactInfo: GetResult[AnnotationCompactInfo] = GetResult { prs =>
    import prs._

    val id = <<[ObjectId]
    val name = <<[String]
    val description = <<[String]
    val ownerId = <<[ObjectId]
    val ownerFirstName = <<[String]
    val ownerLastName = <<[String]
    val othersMayEdit = <<[Boolean]
    val teamIds = parseArrayLiteral(<<[String]).map(ObjectId(_))
    val teamNames = parseArrayLiteral(<<[String])
    val teamOrganizationIds = parseArrayLiteral(<<[String])
    val modified = <<[Instant]
    val tags = parseArrayLiteral(<<[String]).toSet
    val state = AnnotationState.fromString(<<[String]).getOrElse(AnnotationState.Active)
    val isLockedByOwner = <<[Boolean]
    val dataSetName = <<[String]
    val typ = AnnotationType.fromString(<<[String]).getOrElse(AnnotationType.Explorational)
    val visibility = AnnotationVisibility.fromString(<<[String]).getOrElse(AnnotationVisibility.Internal)
    val tracingTime = Option(<<[Long])
    val organizationId = <<[String]
    val tracingIds = parseArrayLiteral(<<[String])
    val annotationLayerNames = parseArrayLiteral(<<[String])
    val annotationLayerTypes = parseArrayLiteral(<<[String])
    val annotationLayerStatistics =
      parseArrayLiteral(<<[String]).map(layerStats => Json.parse(layerStats).validate[JsObject].getOrElse(Json.obj()))

    // format: off
    AnnotationCompactInfo(id, typ, name,description,ownerId,ownerFirstName,ownerLastName, othersMayEdit,teamIds,
      teamNames,teamOrganizationIds,modified,tags,state,isLockedByOwner,dataSetName,visibility,tracingTime,
      organizationId,tracingIds,annotationLayerNames,annotationLayerTypes,annotationLayerStatistics
    )
    // format: on
  }

  /**
    * Find all annotations which are listable by the user specified in 'forUser'
    *
    * @param isFinished
    * If set to `true`, only finished annotations are returned. If set to `false`, only active annotations are returned.
    * If set to `None`, all non-cancelled annotations are returned.
    * @param forUser
    * If set, only annotations of this user are returned. If not set, all annotations are returned.
    * @param filterOwnedOrShared
    * If `true`, the function lists only annotations owned by the user or explicitly shared with them (used for the
    * user's own dashboard). If `false`, it lists all annotations the viewer is allowed to see.
    * @param limit
    * The maximum number of annotations to return.
    * @param pageNumber
    * The page number to return. The first page is 0.
    */
  def findAllListableExplorationals(
      isFinished: Option[Boolean],
      forUser: Option[ObjectId],
      filterOwnedOrShared: Boolean,
      limit: Int,
      pageNumber: Int = 0)(implicit ctx: DBAccessContext): Fox[List[AnnotationCompactInfo]] =
    for {
      accessQuery <- if (filterOwnedOrShared) accessQueryFromAccessQWithPrefix(listAccessQ, q"a.")
      else accessQueryFromAccessQWithPrefix(readAccessQWithPrefix, q"a.")
      stateQuery = getStateQuery(isFinished)
      userQuery = forUser.map(u => q"a._user = $u").getOrElse(q"TRUE")
      typQuery = q"a.typ = ${AnnotationType.Explorational}"
      query = q"""
          -- We need to separate the querying of the annotation with all its inner joins from the 1:n join to collect the shared teams
          -- This is to prevent left-join fanout.
          -- Note that only one of the left joins in it has 1:n, so they can happen together
          -- The WITH is structured this way round to get in the LIMIT early and not fetch the shared teams of all annotations first.
          WITH an AS( -- select annotations with the relevant properties first
            SELECT
              a._id,
              a.name,
              a.description,
              a._user,
              u.firstname,
              u.lastname,
              a.othersmayedit,
              a.modified,
              a.tags,
              a.state,
              a.isLockedByOwner,
              d.name AS datasetName,
              a.typ,
              a.visibility,
              a.tracingtime,
              o._id AS organizationId,
              ARRAY_REMOVE(ARRAY_AGG(al.tracingid), null) AS tracing_ids,
              ARRAY_REMOVE(ARRAY_AGG(al.name), null) AS tracing_names,
              ARRAY_REMOVE(ARRAY_AGG(al.typ :: varchar), null) AS tracing_typs,
              ARRAY_REMOVE(ARRAY_AGG(al.statistics), null) AS annotation_layer_statistics
            FROM webknossos.annotations_ AS a
            JOIN webknossos.users_ u ON u._id = a._user
            JOIN webknossos.datasets_ d ON d._id = a._dataset
            JOIN webknossos.organizations_ AS o ON o._id = d._organization
            JOIN webknossos.annotation_layers AS al ON al._annotation = a._id
            WHERE $stateQuery AND $accessQuery AND $userQuery AND $typQuery
            GROUP BY
              a._id, a.name, a.description, a._user, a.othersmayedit, a.modified,
              a.tags, a.state,  a.islockedbyowner, a.typ, a.visibility, a.tracingtime,
              u.firstname, u.lastname,
              d.name, o._id
            ORDER BY a._id DESC
            LIMIT $limit
            OFFSET ${pageNumber * limit}
          )
          SELECT  -- select now add the shared teams, and propagate everything to the output
            an._id,
            an.name,
            an.description,
            an._user,
            an.firstname,
            an.lastname,
            an.othersmayedit,
            ARRAY_REMOVE(ARRAY_AGG(t._id), null) AS team_ids,
            ARRAY_REMOVE(ARRAY_AGG(t.name), null) AS team_names,
            ARRAY_REMOVE(ARRAY_AGG(o._id), null) AS team_organization_ids,
            an.modified,
            an.tags,
            an.state,
            an.isLockedByOwner,
            an.datasetName,
            an.typ,
            an.visibility,
            an.tracingtime,
            an.organizationId,
            an.tracing_ids,
            an.tracing_names,
            an.tracing_typs,
            an.annotation_layer_statistics
          FROM an
          LEFT JOIN webknossos.annotation_sharedteams ast ON ast._annotation = an._id
          LEFT JOIN webknossos.teams_ t ON ast._team = t._id
          LEFT JOIN webknossos.organizations_ o ON t._organization = o._id
          GROUP BY
            an._id,
            an.name,
            an.description,
            an._user,
            an.firstname,
            an.lastname,
            an.othersmayedit,
            an.modified,
            an.tags,
            an.state,
            an.isLockedByOwner,
            an.datasetName,
            an.typ,
            an.visibility,
            an.tracingtime,
            an.organizationId,
            an.tracing_ids,
            an.tracing_names,
            an.tracing_typs,
            an.annotation_layer_statistics
          ORDER BY an._id DESC
         """
      rows <- run(query.as[AnnotationCompactInfo])
    } yield rows.toList

  def countAllListableExplorationals(isFinished: Option[Boolean])(implicit ctx: DBAccessContext): Fox[Long] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- baseListAccessQ
      rows <- run(q"""SELECT COUNT(*)
                      FROM $existingCollectionName
                      WHERE typ = ${AnnotationType.Explorational}
                      AND $stateQuery
                      AND $accessQuery""".as[Long])
      count <- rows.headOption.toFox
    } yield count
  }

  def findActiveTaskIdsForUser(userId: ObjectId): Fox[List[ObjectId]] = {
    val stateQuery = getStateQuery(isFinished = Some(false))
    for {
      r <- run(q"""SELECT _task
                   FROM $existingCollectionName
                   WHERE _user = $userId
                   AND typ = ${AnnotationType.Task}
                   AND $stateQuery""".as[String])
      r <- Fox.serialCombined(r.toList)(ObjectId.fromString(_))
    } yield r
  }

  def countAllFor(userId: ObjectId, isFinished: Option[Boolean], annotationType: AnnotationType)(
      implicit ctx: DBAccessContext): Fox[Int] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT COUNT(*)
                   FROM $existingCollectionName
                   WHERE _user = $userId
                   AND typ = $annotationType
                   AND $stateQuery
                   AND $accessQuery""".as[Int])
      parsed <- r.headOption
    } yield parsed
  }

  def countForTeam(teamId: ObjectId): Fox[Int] =
    for {
      countList <- run(q"SELECT COUNT(*) FROM $existingCollectionName WHERE _team = $teamId".as[Int])
      count <- countList.headOption
    } yield count

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllFinishedForProject(projectId: ObjectId): Fox[List[Annotation]] =
    for {
      r <- run(q"""SELECT ${columnsWithPrefix("a.")}
                   FROM $existingCollectionName a
                   JOIN webknossos.tasks_ t ON a._task = t._id
                   WHERE t._project = $projectId
                   AND a.typ = ${AnnotationType.Task}
                   AND a.state = ${AnnotationState.Finished}""".as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllActiveForProject(projectId: ObjectId): Fox[List[ObjectId]] =
    for {
      r <- run(q"""SELECT a._id
                   FROM webknossos.annotations_ a
                   JOIN webknossos.tasks_ t ON a._task = t._id
                   JOIN webknossos.projects_ p ON t._project = p._id
                   JOIN webknossos.users_ u ON a._user = u._id
                   WHERE p._id = $projectId
                   AND a.state = ${AnnotationState.Active}
                   AND a.typ = ${AnnotationType.Task} """.as[ObjectId])
    } yield r.toList

  def findBaseIdForTask(taskId: ObjectId)(implicit ctx: DBAccessContext): Fox[ObjectId] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT _id
                   FROM $existingCollectionName
                   WHERE _task = $taskId
                   AND typ = ${AnnotationType.TracingBase}
                   AND state != ${AnnotationState.Cancelled}
                   AND $accessQuery""".as[ObjectId])
      firstRow <- r.headOption
    } yield firstRow

  def findAllByTaskIdAndType(taskId: ObjectId, typ: AnnotationType)(
      implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE _task = $taskId
                   AND typ = $typ
                   AND state != ${AnnotationState.Cancelled}
                   AND $accessQuery""".as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllByPublication(publicationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""SELECT $columns
                   FROM $existingCollectionName
                   WHERE _publication = $publicationId
                   AND $accessQuery""".as[AnnotationsRow]).map(_.toList)
      parsed <- parseAll(r)
    } yield parsed

  def findOneByTracingId(tracingId: String)(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      annotationId <- annotationLayerDAO.findAnnotationIdByTracingId(tracingId)
      annotation <- findOne(annotationId)
    } yield annotation

  // count operations

  def countActiveAnnotationsFor(userId: ObjectId, typ: AnnotationType, excludedTeamIds: List[ObjectId])(
      implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      excludeTeamsQ = if (excludedTeamIds.isEmpty) q"TRUE"
      else q"(NOT t._id IN ${SqlToken.tupleFromList(excludedTeamIds)})"
      countList <- run(q"""SELECT COUNT(*)
                           FROM (
                             SELECT a._id
                             FROM (
                               SELECT $columns
                               FROM $existingCollectionName
                               WHERE _user = $userId
                               AND typ = $typ
                               AND state = ${AnnotationState.Active}
                               AND $accessQuery
                             ) a
                             JOIN webknossos.teams t ON a._team = t._id
                             WHERE $excludeTeamsQ
                           ) q
                         """.as[Int])
      count <- countList.headOption
    } yield count

  def countActiveByTask(taskId: ObjectId, typ: AnnotationType)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      countList <- run(q"""SELECT COUNT(*)
                           FROM $existingCollectionName
                           WHERE _task = $taskId
                           AND typ = $typ
                           AND state = ${AnnotationState.Active}
                           AND $accessQuery""".as[Int])
      count <- countList.headOption
    } yield count

  def countAllForOrganization(organizationId: String): Fox[Int] =
    for {
      countList <- run(q"""SELECT COUNT(*)
                           FROM $existingCollectionName a
                           JOIN webknossos.users_ u ON a._user = u._id
                           WHERE u._organization = $organizationId""".as[Int])
      count <- countList.headOption
    } yield count

  def countAllByDataset(datasetId: ObjectId)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      countList <- run(q"""SELECT COUNT(*)
                           FROM $existingCollectionName
                           WHERE _dataset = $datasetId
                           AND $accessQuery""".as[Int])
      count <- countList.headOption
    } yield count

  // update operations

  def insertOne(a: Annotation): Fox[Unit] = {
    val insertAnnotationQuery = q"""
        INSERT INTO webknossos.annotations(_id, _dataset, _task, _team, _user, description, visibility,
                                           name, viewConfiguration, state, tags, tracingTime, typ, othersMayEdit, created, modified, isDeleted)
        VALUES(${a._id}, ${a._dataset}, ${a._task}, ${a._team},
         ${a._user}, ${a.description}, ${a.visibility}, ${a.name},
         ${a.viewConfiguration},
         ${a.state},
         ${a.tags}, ${a.tracingTime}, ${a.typ},
         ${a.othersMayEdit},
         ${a.created}, ${a.modified}, ${a.isDeleted})
         """.asUpdate
    val insertLayerQueries = annotationLayerDAO.insertLayerQueries(a._id, a.annotationLayers)
    for {
      _ <- run(DBIO.sequence(insertAnnotationQuery +: insertLayerQueries).transactionally)
    } yield ()
  }

  // Task only, thus hard replacing tracing ids
  def updateInitialized(a: Annotation): Fox[Unit] = {
    val updateAnnotationQuery = q"""
             UPDATE webknossos.annotations
             SET
               _dataset = ${a._dataset},
               _team = ${a._team},
               _user = ${a._user},
               description = ${a.description},
               visibility = ${a.visibility},
               name = ${a.name},
               viewConfiguration = ${a.viewConfiguration},
               state = ${a.state},
               tags = ${a.tags.toList},
               tracingTime = ${a.tracingTime},
               typ = ${a.typ},
               othersMayEdit = ${a.othersMayEdit},
               created = ${a.created},
               modified = ${a.modified},
               isDeleted = ${a.isDeleted}
             WHERE _id = ${a._id}
          """.asUpdate
    val deleteLayersQuery = annotationLayerDAO.deleteAllForAnnotationQuery(a._id)
    val insertLayerQueries = annotationLayerDAO.insertLayerQueries(a._id, a.annotationLayers)
    for {
      _ <- run(DBIO.sequence(updateAnnotationQuery +: deleteLayersQuery +: insertLayerQueries).transactionally)
      _ = logger.info(s"Initialized task annotation ${a._id}, state is now ${a.state}")
    } yield ()
  }

  def abortInitializingAnnotation(id: ObjectId): Fox[Unit] = {
    val deleteLayersQuery = annotationLayerDAO.deleteAllForAnnotationQuery(id)
    val deleteAnnotationQuery =
      q"DELETE FROM webknossos.annotations WHERE _id = $id AND state = ${AnnotationState.Initializing}".asUpdate
    val composed = DBIO.sequence(List(deleteLayersQuery, deleteAnnotationQuery)).transactionally
    for {
      _ <- run(composed.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
      _ = logger.info(s"Aborted initializing task annotation $id")
    } yield ()
  }

  def deleteOldInitializingAnnotations(): Fox[Unit] =
    for {
      _ <- run(q"""DELETE FROM webknossos.annotations
                   WHERE state = ${AnnotationState.Initializing}
                   AND created < (NOW() - INTERVAL '1 hour')""".asUpdate)
    } yield ()

  def logTime(id: ObjectId, time: FiniteDuration)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      _ <- run(q"""UPDATE webknossos.annotations
                   SET tracingTime = COALESCE(tracingTime, 0) + ${time.toMillis}
                   WHERE _id = $id""".asUpdate)
    } yield ()

  def updateState(id: ObjectId, state: AnnotationState)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      query = q"UPDATE webknossos.annotations SET state = $state WHERE _id = $id".asUpdate
      _ <- run(
        query.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)) ?~> "FAILED: run in AnnotationSQLDAO.updateState"
      _ = logger.info(s"Updated state of Annotation $id to $state, access context: ${ctx.toStringAnonymous}")
    } yield ()

  def updateLockedState(id: ObjectId, isLocked: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      query = q"UPDATE webknossos.annotations SET isLockedByOwner = $isLocked WHERE _id = $id".asUpdate
      _ <- run(
        query.withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)) ?~> "FAILED: run in AnnotationSQLDAO.updateState"
      _ = logger.info(
        s"Updated isLockedByOwner of Annotation $id to $isLocked, access context: ${ctx.toStringAnonymous}")
    } yield ()

  def updateDescription(id: ObjectId, description: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- updateStringCol(id, _.description, description)
    } yield ()

  def updateName(id: ObjectId, name: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- updateStringCol(id, _.name, name)
    } yield ()

  def updateVisibility(id: ObjectId, visibility: AnnotationVisibility.Value)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"UPDATE webknossos.annotations_ SET visibility = $visibility WHERE _id = $id".asUpdate)
    } yield ()

  def updateTags(id: ObjectId, tags: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"UPDATE webknossos.annotations SET tags = $tags WHERE _id = $id".asUpdate)
    } yield ()

  def updateModified(id: ObjectId, modified: Instant)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"UPDATE webknossos.annotations SET modified = $modified WHERE _id = $id".asUpdate)
    } yield ()

  def updateUser(id: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateObjectIdCol(id, _._User, userId)

  def updateOthersMayEdit(id: ObjectId, othersMayEdit: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateBooleanCol(id, _.othersmayedit, othersMayEdit)

  def updateViewConfiguration(id: ObjectId, viewConfiguration: Option[JsObject])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"UPDATE webknossos.annotations SET viewConfiguration = $viewConfiguration WHERE _id = $id".asUpdate)
    } yield ()

  def addContributor(id: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"""INSERT INTO webknossos.annotation_contributors (_annotation, _user)
                   VALUES($id, $userId)
                   ON CONFLICT DO NOTHING""".asUpdate)
    } yield ()

  def updateTeamsForSharedAnnotation(annotationId: ObjectId, teams: List[ObjectId])(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = q"DELETE FROM webknossos.annotation_sharedTeams WHERE _annotation = $annotationId".asUpdate
    val insertQueries = teams.map(teamId => q"""INSERT INTO webknossos.annotation_sharedTeams(_annotation, _team)
                                                VALUES($annotationId, $teamId)""".asUpdate)

    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
    for {
      _ <- assertUpdateAccess(annotationId)
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }
}
