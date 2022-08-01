package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.schema.Tables._
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import javax.inject.Inject
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import play.api.libs.json._
import slick.jdbc.GetResult._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import slick.sql.SqlAction
import utils.{ObjectId, SQLClient, SQLDAO, SimpleSQLDAO}

import scala.concurrent.ExecutionContext

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
    created: Long = System.currentTimeMillis,
    modified: Long = System.currentTimeMillis,
    isDeleted: Boolean = false
) extends FoxImplicits {

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

  def isRevertPossible: Boolean =
    // Unfortunately, we can not revert all tracings, because we do not have the history for all of them
    // hence we need a way to decide if a tracing can safely be reverted. We will use the created date of the
    // annotation to do so
    created > 1470002400000L // 1.8.2016, 00:00:00

}

class AnnotationLayerDAO @Inject()(SQLClient: SQLClient)(implicit ec: ExecutionContext)
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
        sql"select _annotation, tracingId, typ, name from webknossos.annotation_layers where _annotation = $annotationId order by tracingId"
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

  def insertOneQuery(annotationId: ObjectId, a: AnnotationLayer): SqlAction[Int, NoStream, Effect] =
    sqlu"""insert into webknossos.annotation_layers(_annotation, tracingId, typ, name)
            values($annotationId, ${a.tracingId}, '#${a.typ.toString}', ${a.name})"""

  def findAnnotationIdByTracingId(tracingId: String): Fox[ObjectId] =
    for {
      rList <- run(sql"select _annotation from webknossos.annotation_layers where tracingId = $tracingId".as[String])
      head: String <- rList.headOption.toFox
      parsed <- ObjectId.fromString(head)
    } yield parsed

  def replaceTracingId(annotationId: ObjectId, oldTracingId: String, newTracingId: String): Fox[Unit] =
    for {
      _ <- run(
        sqlu"update webknossos.annotation_layers set tracingId = $newTracingId where _annotation = $annotationId and tracingId = $oldTracingId")
    } yield ()

  def updateName(annotationId: ObjectId, tracingId: String, newName: String): Fox[Unit] =
    for {
      _ <- run(
        sqlu"update webknossos.annotation_layers set name = $newName where _annotation = $annotationId and tracingId = $tracingId")
    } yield ()

  def deleteAllForAnnotationQuery(annotationId: ObjectId): SqlAction[Int, NoStream, Effect] =
    sqlu"delete from webknossos.annotation_layers where _annotation = $annotationId"

}

class AnnotationDAO @Inject()(sqlClient: SQLClient, annotationLayerDAO: AnnotationLayerDAO)(
    implicit ec: ExecutionContext)
    extends SQLDAO[Annotation, AnnotationsRow, Annotations](sqlClient) {
  val collection = Annotations

  def idColumn(x: Annotations): Rep[String] = x._Id
  def isDeletedColumn(x: Annotations): Rep[Boolean] = x.isdeleted

  def parse(r: AnnotationsRow): Fox[Annotation] =
    for {
      state <- AnnotationState.fromString(r.state).toFox
      typ <- AnnotationType.fromString(r.typ).toFox
      viewconfigurationOpt <- Fox.runOptional(r.viewconfiguration)(JsonHelper.parseJsonToFox[JsObject](_))
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
        parseArrayTuple(r.tags).toSet,
        r.tracingtime,
        typ,
        r.othersmayedit,
        r.created.getTime,
        r.modified.getTime,
        r.isdeleted
      )
    }

  override def anonymousReadAccessQ(sharingToken: Option[String]) = s"visibility = '${AnnotationVisibility.Public}'"

  private def listAccessQ(requestingUserId: ObjectId): String =
    s"""
        (
          _user = '${requestingUserId.id}'
          or (
            (visibility = '${AnnotationVisibility.Public}' or visibility = '${AnnotationVisibility.Internal}')
            and (
              _id in (
                select distinct a._annotation
                from webknossos.annotation_sharedTeams a
                join webknossos.user_team_roles t
                on a._team = t._team
                where t._user = '${requestingUserId.id}'
              )
              or
              _id in (
                select _annotation from webknossos.annotation_contributors
                where _user = '${requestingUserId.id}'
              )
            )
          )
        )
       """

  override def readAccessQ(requestingUserId: ObjectId): String =
    s"""(
              visibility = '${AnnotationVisibility.Public}'
           or (visibility = '${AnnotationVisibility.Internal}'
               and (select _organization from webknossos.teams where webknossos.teams._id = _team)
                 in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}'))
           or _team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}' and isTeamManager)
           or _user = '${requestingUserId.id}'
           or (select _organization from webknossos.teams where webknossos.teams._id = _team)
             in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin)
         )"""

  override def deleteAccessQ(requestingUserId: ObjectId) =
    s"""(_team in (select _team from webknossos.user_team_roles where isTeamManager and _user = '${requestingUserId.id}') or _user = '${requestingUserId.id}'
       or (select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""

  override def updateAccessQ(requestingUserId: ObjectId): String =
    deleteAccessQ(requestingUserId)

  // read operations

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"select #$columns from #$existingCollectionName where _id = ${id.id} and #$accessQuery".as[AnnotationsRow])
      parsed <- parseFirst(r, id)
    } yield parsed

  private def getStateQuery(isFinished: Option[Boolean]) =
    isFinished match {
      case Some(true)  => s"state = '${AnnotationState.Finished.toString}'"
      case Some(false) => s"state = '${AnnotationState.Active.toString}'"
      case None        => s"state != '${AnnotationState.Cancelled.toString}'"
    }

  def findAllFor(userId: ObjectId,
                 isFinished: Option[Boolean],
                 annotationType: AnnotationType,
                 limit: Int,
                 pageNumber: Int = 0)(implicit ctx: DBAccessContext): Fox[List[Annotation]] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"""select #$columns from #$existingCollectionName
                     where _user = ${userId.id} and typ = '#${annotationType.toString}' and #$stateQuery and #$accessQuery
                     order by _id desc limit $limit offset ${pageNumber * limit}""".as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed
  }

  def findAllListableExplorationals(isFinished: Option[Boolean], limit: Int, pageNumber: Int = 0)(
      implicit ctx: DBAccessContext): Fox[List[Annotation]] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(sql"""select #$columns from #$existingCollectionName
                     where typ = '#${AnnotationType.Explorational.toString}' and #$stateQuery and #$accessQuery
                     order by _id desc limit $limit offset ${pageNumber * limit}""".as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed
  }

  def countAllListableExplorationals(isFinished: Option[Boolean])(
      implicit ctx: DBAccessContext): Fox[List[Annotation]] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- accessQueryFromAccessQ(listAccessQ)
      r <- run(
        sql"""select count(_id) from #$existingCollectionName
                     typ = '#${AnnotationType.Explorational.toString}' and #$stateQuery and #$accessQuery"""
          .as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed
  }

  def findActiveTaskIdsForUser(userId: ObjectId): Fox[List[ObjectId]] = {

    val stateQuery = getStateQuery(isFinished = Some(false))
    for {
      r <- run(sql"""select _task from #$existingCollectionName
             where _user = ${userId.id} and typ = '#${AnnotationType.Task.toString}' and #$stateQuery""".as[String])
      r <- Fox.serialCombined(r.toList)(ObjectId.fromString(_))
    } yield r

  }

  def countAllFor(userId: ObjectId, isFinished: Option[Boolean], annotationType: AnnotationType)(
      implicit ctx: DBAccessContext): Fox[Int] = {
    val stateQuery = getStateQuery(isFinished)
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"""select count(*) from #$existingCollectionName
                     where _user = ${userId.id} and typ = '#${annotationType.toString}' and #$stateQuery and #$accessQuery"""
          .as[Int])
      parsed <- r.headOption
    } yield parsed
  }

  def countForTeam(teamId: ObjectId): Fox[Int] =
    for {
      countList <- run(sql"select count(_id) from #$existingCollectionName where _team = $teamId".as[Int])
      count <- countList.headOption
    } yield count

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllFinishedForProject(projectId: ObjectId): Fox[List[Annotation]] =
    for {
      r <- run(
        sql"""select #${columnsWithPrefix("a.")} from #$existingCollectionName a
                     join webknossos.tasks_ t on a._task = t._id
                     where t._project = ${projectId.id} and a.typ = '#${AnnotationType.Task.toString}' and a.state = '#${AnnotationState.Finished.toString}'"""
          .as[AnnotationsRow])
      parsed <- parseAll(r)
    } yield parsed

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllActiveForProject(projectId: ObjectId): Fox[List[ObjectId]] =
    for {
      r <- run(sql""" select a._id from
                        webknossos.annotations_ a
                        join webknossos.tasks_ t on a._task = t._id
                        join webknossos.projects_ p on t._project = p._id
                        join webknossos.users_ u on a._user = u._id
                        where p._id = $projectId
                        and a.state = '#${AnnotationState.Active.toString}'
                        and a.typ = '#${AnnotationType.Task}' """.as[String])
    } yield r.map(ObjectId(_)).toList

  def findAllByTaskIdAndType(taskId: ObjectId, typ: AnnotationType)(
      implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"""select #$columns from #$existingCollectionName
                     where _task = ${taskId.id} and typ = '#${typ.toString}' and state != '#${AnnotationState.Cancelled.toString}' and #$accessQuery"""
          .as[AnnotationsRow])
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
      excludeTeamsQ = if (excludedTeamIds.isEmpty) "true"
      else s"(not t._id in ${writeStructTupleWithQuotes(excludedTeamIds.map(t => sanitize(t.id)))})"
      countList <- run(sql"""select count(*)
                         from (select a._id from
                                  (select #$columns
                                   from #$existingCollectionName
                                   where _user = ${userId.id} and typ = '#${typ.toString}' and state = '#${AnnotationState.Active.toString}' and #$accessQuery) a
                                  join webknossos.teams t on a._team = t._id where #$excludeTeamsQ) q
                         """.as[Int])
      count <- countList.headOption
    } yield count

  def countActiveByTask(taskId: ObjectId, typ: AnnotationType)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      countList <- run(
        sql"""select count(*) from (select _id from #$existingCollectionName where _task = ${taskId.id} and typ = '#${typ.toString}' and state = '#${AnnotationState.Active.toString}' and #$accessQuery) q"""
          .as[Int])
      count <- countList.headOption
    } yield count

  def countAllForOrganization(organizationId: ObjectId): Fox[Int] =
    for {
      countList <- run(
        sql"select count(*) from (select a._id from #$existingCollectionName a join webknossos.users_ u on a._user = u._id where u._organization = $organizationId) q"
          .as[Int])
      count <- countList.headOption
    } yield count

  // update operations

  def insertOne(a: Annotation): Fox[Unit] = {
    val viewConfigurationStr: Option[String] = a.viewConfiguration.map(Json.toJson(_).toString)
    val insertAnnotationQuery = sqlu"""
        insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, description, visibility,
                                           name, viewConfiguration, state, statistics, tags, tracingTime, typ, othersMayEdit, created, modified, isDeleted)
        values(${a._id.id}, ${a._dataSet.id}, ${a._task.map(_.id)}, ${a._team.id},
         ${a._user.id}, ${a.description}, '#${a.visibility.toString}', ${a.name},
         #${optionLiteral(viewConfigurationStr.map(sanitize))},
         '#${a.state.toString}', '#${sanitize(a.statistics.toString)}',
         '#${writeArrayTuple(a.tags.toList)}', ${a.tracingTime}, '#${a.typ.toString}',
         ${a.othersMayEdit},
         ${new java.sql.Timestamp(a.created)}, ${new java.sql.Timestamp(a.modified)}, ${a.isDeleted})
         """
    val insertLayerQueries = annotationLayerDAO.insertLayerQueries(a._id, a.annotationLayers)
    for {
      _ <- run(DBIO.sequence(insertAnnotationQuery +: insertLayerQueries).transactionally)
    } yield ()
  }

  // Task only, thus hard replacing tracing ids
  def updateInitialized(a: Annotation): Fox[Unit] = {
    val viewConfigurationStr: Option[String] = a.viewConfiguration.map(Json.toJson(_).toString)
    val updateAnnotationQuery = sqlu"""
             update webknossos.annotations
             set
               _dataSet = ${a._dataSet.id},
               _team = ${a._team.id},
               _user = ${a._user.id},
               description = ${a.description},
               visibility = '#${a.visibility.toString}',
               name = ${a.name},
               viewConfiguration = #${optionLiteral(viewConfigurationStr.map(sanitize))},
               state = '#${a.state.toString}',
               statistics = '#${sanitize(a.statistics.toString)}',
               tags = '#${writeArrayTuple(a.tags.toList)}',
               tracingTime = ${a.tracingTime},
               typ = '#${a.typ.toString}',
               othersMayEdit = ${a.othersMayEdit},
               created = ${new java.sql.Timestamp(a.created)},
               modified = ${new java.sql.Timestamp(a.modified)},
               isDeleted = ${a.isDeleted}
             where _id = ${a._id.id}
          """
    val deleteLayersQuery = annotationLayerDAO.deleteAllForAnnotationQuery(a._id)
    val insertLayerQueries = annotationLayerDAO.insertLayerQueries(a._id, a.annotationLayers)
    for {
      _ <- run(DBIO.sequence(updateAnnotationQuery +: deleteLayersQuery +: insertLayerQueries).transactionally)
      _ = logger.info(s"Initialized task annotation ${a._id}, state is now ${a.state.toString}")
    } yield ()
  }

  def abortInitializingAnnotation(id: ObjectId): Fox[Unit] = {
    val deleteLayersQuery = annotationLayerDAO.deleteAllForAnnotationQuery(id)
    val deleteAnnotationQuery =
      sqlu"delete from webknossos.annotations where _id = $id and state = '#${AnnotationState.Initializing.toString}'"
    val composed = DBIO.sequence(List(deleteLayersQuery, deleteAnnotationQuery)).transactionally
    for {
      _ <- run(composed.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
      _ = logger.info(s"Aborted initializing task annotation ${id.toString}")
    } yield ()
  }

  def deleteOldInitializingAnnotations(): Fox[Unit] =
    for {
      _ <- run(
        sqlu"delete from webknossos.annotations where state = '#${AnnotationState.Initializing.toString}' and created < (now() - interval '1 hour')")
    } yield ()

  def logTime(id: ObjectId, time: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      _ <- run(
        sqlu"update webknossos.annotations set tracingTime = Coalesce(tracingTime, 0) + $time where _id = ${id.id}") ?~> "FAILED: run in AnnotationSQLDAO.logTime"
    } yield ()

  def updateState(id: ObjectId, state: AnnotationState)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      _ <- run(
        sqlu"update webknossos.annotations set state = '#$state' where _id = ${id.id}"
          .withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      ) ?~> "FAILED: run in AnnotationSQLDAO.updateState"
      _ = logger.info(
        s"Updated state of Annotation ${id.toString} to ${state.toString}, access context: ${ctx.toStringAnonymous}")
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

  def updateVisibility(id: ObjectId, visibilityString: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- AnnotationVisibility.fromString(visibilityString).toFox
      _ <- run(sqlu"update webknossos.annotations_ set visibility = '#$visibilityString' where _id = $id")
    } yield ()

  def updateTags(id: ObjectId, tags: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set tags = '#${writeArrayTuple(tags)}' where _id = ${id.id}")
    } yield ()

  def updateModified(id: ObjectId, modified: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(
        sqlu"update webknossos.annotations set modified = ${new java.sql.Timestamp(modified)} where _id = ${id.id}")
    } yield ()

  def updateStatistics(id: ObjectId, statistics: JsObject)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(
        sqlu"update webknossos.annotations set statistics = '#${sanitize(statistics.toString)}' where _id = ${id.id}")
    } yield ()

  def updateUser(id: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateObjectIdCol(id, _._User, userId)

  def updateOthersMayEdit(id: ObjectId, othersMayEdit: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateBooleanCol(id, _.othersmayedit, othersMayEdit)

  def updateViewConfiguration(id: ObjectId, viewConfiguration: Option[JsObject])(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val viewConfigurationStr: Option[String] = viewConfiguration.map(Json.toJson(_).toString)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set viewConfiguration = #${optionLiteral(
        viewConfigurationStr.map(sanitize))} where _id = ${id.id}")
    } yield ()
  }

  def addContributor(id: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(
        sqlu"insert into webknossos.annotation_contributors (_annotation, _user) values($id, $userId) on conflict do nothing")
    } yield ()
}

class SharedAnnotationsDAO @Inject()(annotationDAO: AnnotationDAO, sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def sharedTeamsFor(annotationId: ObjectId): Fox[List[String]] =
    for (result <- run(
           sql"select _team from webknossos.annotation_sharedTeams where _annotation = $annotationId".as[String]))
      yield result.toList

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllSharedForTeams(teams: List[ObjectId]): Fox[List[Annotation]] =
    for {
      result <- run(
        sql"""select distinct #${annotationDAO.columnsWithPrefix("a.")} from webknossos.annotations_ a
                            join webknossos.annotation_sharedTeams l on a._id = l._annotation
                            where l._team in #${writeStructTupleWithQuotes(teams.map(t => sanitize(t.toString)))}"""
          .as[AnnotationsRow])
      parsed <- Fox.combined(result.toList.map(annotationDAO.parse))
    } yield parsed

  def updateTeamsForSharedAnnotation(annotationId: ObjectId, teams: List[ObjectId])(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val clearQuery = sqlu"delete from webknossos.annotation_sharedTeams where _annotation = $annotationId"

    val insertQueries = teams.map(teamId => sqlu"""insert into webknossos.annotation_sharedTeams(_annotation, _team)
                                                              values($annotationId, $teamId)""")

    val composedQuery = DBIO.sequence(List(clearQuery) ++ insertQueries)
    for {
      _ <- annotationDAO.assertUpdateAccess(annotationId)
      _ <- run(composedQuery.transactionally.withTransactionIsolation(Serializable),
               retryCount = 50,
               retryIfErrorContains = List(transactionSerializationError))
    } yield ()
  }

}
