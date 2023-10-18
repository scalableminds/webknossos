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
import slick.jdbc.GetResult._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import slick.sql.SqlAction
import utils.ObjectId
import utils.sql.{SQLDAO, SimpleSQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.FiniteDuration

case class Annotation(
    _id: ObjectId,
    _dataSet: ObjectId,
    _task: Option[ObjectId] = None,
    _team: ObjectId,
    _user: ObjectId,
    annotationLayers: List[AnnotationLayer],
    description: String = "",
    visibility: AnnotationVisibility.Value = AnnotationVisibility.Internal,
    name: String = "",
    viewConfiguration: Option[JsObject] = None,
    state: AnnotationState.Value = Active,
    statistics: JsObject = Json.obj(),
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
      _ <- bool2Fox(annotationLayers.count(_.typ == AnnotationLayerType.Skeleton) <= 1) ?~> "annotation.multiLayers.skeleton.notImplemented"
    } yield annotationLayers.find(_.typ == AnnotationLayerType.Skeleton).map(_.tracingId)

  def volumeTracingId(implicit ec: ExecutionContext): Fox[Option[String]] =
    for {
      _ <- bool2Fox(annotationLayers.count(_.typ == AnnotationLayerType.Volume) <= 1) ?~> "annotation.multiLayers.volume.notImplemented"
    } yield annotationLayers.find(_.typ == AnnotationLayerType.Volume).map(_.tracingId)

  def volumeAnnotationLayers: List[AnnotationLayer] = annotationLayers.filter(_.typ == AnnotationLayerType.Volume)

  def skeletonAnnotationLayers: List[AnnotationLayer] = annotationLayers.filter(_.typ == AnnotationLayerType.Skeleton)

}

class AnnotationLayerDAO @Inject()(SQLClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(SQLClient) {

  private def parse(r: AnnotationLayersRow): Fox[AnnotationLayer] =
    for {
      typ <- AnnotationLayerType.fromString(r.typ)
    } yield {
      AnnotationLayer(
        r.tracingid,
        typ,
        r.name
      )
    }

  def findAnnotationLayersFor(annotationId: ObjectId): Fox[List[AnnotationLayer]] =
    for {
      rows <- run(
        q"select _annotation, tracingId, typ, name from webknossos.annotation_layers where _annotation = $annotationId order by tracingId"
          .as[AnnotationLayersRow])
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
    q"""insert into webknossos.annotation_layers(_annotation, tracingId, typ, name)
            values($annotationId, ${a.tracingId}, ${a.typ}, ${a.name})""".asUpdate

  def deleteOne(annotationId: ObjectId, layerName: String): Fox[Unit] =
    for {
      _ <- run(q"""delete from webknossos.annotation_layers where _annotation = $annotationId and
             name = $layerName""".asUpdate)
    } yield ()

  def findAnnotationIdByTracingId(tracingId: String): Fox[ObjectId] =
    for {
      rList <- run(q"select _annotation from webknossos.annotation_layers where tracingId = $tracingId".as[String])
      head: String <- rList.headOption.toFox
      parsed <- ObjectId.fromString(head)
    } yield parsed

  def findAllVolumeLayers: Fox[List[AnnotationLayer]] =
    for {
      rows <- run(
        q"select _annotation, tracingId, typ, name from webknossos.annotation_layers where typ = 'Volume'"
          .as[AnnotationLayersRow])
      parsed <- Fox.serialCombined(rows.toList)(parse)
    } yield parsed

  def replaceTracingId(annotationId: ObjectId, oldTracingId: String, newTracingId: String): Fox[Unit] =
    for {
      _ <- run(
        q"update webknossos.annotation_layers set tracingId = $newTracingId where _annotation = $annotationId and tracingId = $oldTracingId".asUpdate)
    } yield ()

  def updateName(annotationId: ObjectId, tracingId: String, newName: String): Fox[Unit] =
    for {
      _ <- run(
        q"update webknossos.annotation_layers set name = $newName where _annotation = $annotationId and tracingId = $tracingId".asUpdate)
    } yield ()

  def deleteAllForAnnotationQuery(annotationId: ObjectId): SqlAction[Int, NoStream, Effect] =
    q"delete from webknossos.annotation_layers where _annotation = $annotationId".asUpdate

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
        Json.parse(r.statistics).as[JsObject],
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

  private def listAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""
        (
          _user = $requestingUserId
          or (
            (visibility = ${AnnotationVisibility.Public} or visibility = ${AnnotationVisibility.Internal})
            and (
              _id in (
                select distinct a._annotation
                from webknossos.annotation_sharedTeams a
                join webknossos.user_team_roles t
                on a._team = t._team
                where t._user = $requestingUserId
              )
              or
              _id in (
                select _annotation from webknossos.annotation_contributors
                where _user = $requestingUserId
              )
            )
          )
        )
       """

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"""(
              visibility = ${AnnotationVisibility.Public}
           or (visibility = ${AnnotationVisibility.Internal}
               and (select _organization from webknossos.teams where webknossos.teams._id = _team)
                 in (select _organization from webknossos.users_ where _id = $requestingUserId))
           or _team in (select _team from webknossos.user_team_roles where _user = $requestingUserId and isTeamManager)
           or _user = $requestingUserId
           or (select _organization from webknossos.teams where webknossos.teams._id = _team)
             in (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin)
         )"""

  override protected def deleteAccessQ(requestingUserId: ObjectId) =
    q"""(_team in (select _team from webknossos.user_team_roles where isTeamManager and _user = $requestingUserId) or _user = $requestingUserId
       or (select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = $requestingUserId and isAdmin))"""

  override protected def updateAccessQ(requestingUserId: ObjectId): SqlToken =
    deleteAccessQ(requestingUserId)

  // read operations

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"select $columns from $existingCollectionName where _id = $id and $accessQuery".as[AnnotationsRow])
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
      r <- run(q"""select $columns from $existingCollectionName
                   where _user = $userId and typ = $annotationType and $stateQuery and $accessQuery
                   order by _id desc limit $limit offset ${pageNumber * limit}""".as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed
  }

  def findAllListableExplorationals(isFinished: Option[Boolean], limit: Int, pageNumber: Int = 0)(
      implicit ctx: DBAccessContext): Fox[List[Annotation]] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(q"""select $columns from $existingCollectionName
                   where typ = ${AnnotationType.Explorational} and $stateQuery and $accessQuery
                   order by _id desc limit $limit offset ${pageNumber * limit}""".as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed
  }

  def countAllListableExplorationals(isFinished: Option[Boolean])(implicit ctx: DBAccessContext): Fox[Long] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      rows <- run(q"""select count(_id) from $existingCollectionName
                   where typ = ${AnnotationType.Explorational} and ($stateQuery) and ($accessQuery)""".as[Long])
      count <- rows.headOption.toFox
    } yield count
  }

  def findActiveTaskIdsForUser(userId: ObjectId): Fox[List[ObjectId]] = {
    val stateQuery = getStateQuery(isFinished = Some(false))
    for {
      r <- run(q"""select _task
                   from $existingCollectionName
                   where _user = $userId and typ = ${AnnotationType.Task} and $stateQuery""".as[String])
      r <- Fox.serialCombined(r.toList)(ObjectId.fromString(_))
    } yield r
  }

  def countAllFor(userId: ObjectId, isFinished: Option[Boolean], annotationType: AnnotationType)(
      implicit ctx: DBAccessContext): Fox[Int] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- readAccessQuery
      r <- run(q"""select count(*)
                   from $existingCollectionName
                   where _user = $userId and typ = $annotationType and $stateQuery and $accessQuery""".as[Int])
      parsed <- r.headOption
    } yield parsed
  }

  def countForTeam(teamId: ObjectId): Fox[Int] =
    for {
      countList <- run(q"select count(_id) from $existingCollectionName where _team = $teamId".as[Int])
      count <- countList.headOption
    } yield count

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllFinishedForProject(projectId: ObjectId): Fox[List[Annotation]] =
    for {
      r <- run(
        q"""select ${columnsWithPrefix("a.")} from $existingCollectionName a
                   join webknossos.tasks_ t on a._task = t._id
                   where t._project = $projectId and a.typ = ${AnnotationType.Task} and a.state = ${AnnotationState.Finished}"""
          .as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllActiveForProject(projectId: ObjectId): Fox[List[ObjectId]] =
    for {
      r <- run(q"""select a._id from
                   webknossos.annotations_ a
                   join webknossos.tasks_ t on a._task = t._id
                   join webknossos.projects_ p on t._project = p._id
                   join webknossos.users_ u on a._user = u._id
                   where p._id = $projectId
                   and a.state = ${AnnotationState.Active}
                   and a.typ = ${AnnotationType.Task} """.as[String])
    } yield r.map(ObjectId(_)).toList

  def findAllByTaskIdAndType(taskId: ObjectId, typ: AnnotationType)(
      implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"""select $columns from $existingCollectionName
                   where _task = $taskId and typ = $typ and state != ${AnnotationState.Cancelled} and $accessQuery"""
          .as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findAllByPublication(publicationId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"select $columns from $existingCollectionName where _publication = $publicationId and $accessQuery"
          .as[AnnotationsRow]).map(_.toList)
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
      excludeTeamsQ = if (excludedTeamIds.isEmpty) q"${true}"
      else q"(not t._id in ${SqlToken.tupleFromList(excludedTeamIds)})"
      countList <- run(q"""select count(*)
                         from (select a._id from
                                  (select $columns
                                   from $existingCollectionName
                                   where _user = $userId and typ = $typ and state = ${AnnotationState.Active} and $accessQuery) a
                                  join webknossos.teams t on a._team = t._id where $excludeTeamsQ) q
                         """.as[Int])
      count <- countList.headOption
    } yield count

  def countActiveByTask(taskId: ObjectId, typ: AnnotationType)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      countList <- run(q"""select count(*) from $existingCollectionName
              where _task = $taskId and typ = $typ and state = ${AnnotationState.Active} and $accessQuery""".as[Int])
      count <- countList.headOption
    } yield count

  def countAllForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      countList <- run(
        q"select count(a._id) from $existingCollectionName a join webknossos.users_ u on a._user = u._id where u._organization = $organizationId"
          .as[Int])
      count <- countList.headOption
    } yield count

  // update operations

  def insertOne(a: Annotation): Fox[Unit] = {
    val insertAnnotationQuery = q"""
        insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, description, visibility,
                                           name, viewConfiguration, state, statistics, tags, tracingTime, typ, othersMayEdit, created, modified, isDeleted)
        values(${a._id}, ${a._dataSet}, ${a._task}, ${a._team},
         ${a._user}, ${a.description}, ${a.visibility}, ${a.name},
         ${a.viewConfiguration},
         ${a.state}, ${a.statistics},
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
             update webknossos.annotations
             set
               _dataSet = ${a._dataSet},
               _team = ${a._team},
               _user = ${a._user},
               description = ${a.description},
               visibility = ${a.visibility},
               name = ${a.name},
               viewConfiguration = ${a.viewConfiguration},
               state = ${a.state},
               statistics = ${a.statistics},
               tags = ${a.tags.toList},
               tracingTime = ${a.tracingTime},
               typ = ${a.typ},
               othersMayEdit = ${a.othersMayEdit},
               created = ${a.created},
               modified = ${a.modified},
               isDeleted = ${a.isDeleted}
             where _id = ${a._id}
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
      q"delete from webknossos.annotations where _id = $id and state = ${AnnotationState.Initializing}".asUpdate
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
      _ <- run(
        q"delete from webknossos.annotations where state = ${AnnotationState.Initializing} and created < (now() - interval '1 hour')".asUpdate)
    } yield ()

  def logTime(id: ObjectId, time: FiniteDuration)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      _ <- run(
        q"update webknossos.annotations set tracingTime = Coalesce(tracingTime, 0) + ${time.toMillis} where _id = $id".asUpdate) ?~> "FAILED: run in AnnotationSQLDAO.logTime"
    } yield ()

  def updateState(id: ObjectId, state: AnnotationState)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      _ <- run(
        q"update webknossos.annotations set state = $state where _id = $id".asUpdate
          .withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      ) ?~> "FAILED: run in AnnotationSQLDAO.updateState"
      _ = logger.info(s"Updated state of Annotation $id to $state, access context: ${ctx.toStringAnonymous}")
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
      _ <- run(q"update webknossos.annotations_ set visibility = $visibility where _id = $id".asUpdate)
    } yield ()

  def updateTags(id: ObjectId, tags: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"update webknossos.annotations set tags = $tags where _id = $id".asUpdate)
    } yield ()

  def updateModified(id: ObjectId, modified: Instant)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"update webknossos.annotations set modified = $modified where _id = $id".asUpdate)
    } yield ()

  def updateStatistics(id: ObjectId, statistics: JsObject)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"update webknossos.annotations set statistics = $statistics where _id = $id".asUpdate)
    } yield ()

  def updateUser(id: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateObjectIdCol(id, _._User, userId)

  def updateOthersMayEdit(id: ObjectId, othersMayEdit: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateBooleanCol(id, _.othersmayedit, othersMayEdit)

  def updateViewConfiguration(id: ObjectId, viewConfiguration: Option[JsObject])(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q"update webknossos.annotations set viewConfiguration = $viewConfiguration where _id = $id".asUpdate)
    } yield ()

  def addContributor(id: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(
        q"insert into webknossos.annotation_contributors (_annotation, _user) values($id, $userId) on conflict do nothing".asUpdate)
    } yield ()

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllSharedForTeams(teams: List[ObjectId]): Fox[List[Annotation]] =
    for {
      result <- run(q"""select distinct ${columnsWithPrefix("a.")} from webknossos.annotations_ a
                            join webknossos.annotation_sharedTeams l on a._id = l._annotation
                            where l._team in ${SqlToken.tupleFromList(teams)}""".as[AnnotationsRow])
      parsed <- Fox.combined(result.toList.map(parse))
    } yield parsed

  def updateTeamsForSharedAnnotation(annotationId: ObjectId, teams: List[ObjectId])(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = q"delete from webknossos.annotation_sharedTeams where _annotation = $annotationId".asUpdate

    val insertQueries = teams.map(teamId => q"""insert into webknossos.annotation_sharedTeams(_annotation, _team)
                                                              values($annotationId, $teamId)""".asUpdate)

    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
    for {
      _ <- assertUpdateAccess(annotationId)
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }
}
