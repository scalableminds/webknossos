package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.schema.Tables._
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import play.api.libs.json._
import slick.jdbc.GetResult._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO, SimpleSQLDAO}
import javax.inject.Inject

import scala.concurrent.ExecutionContext

case class Annotation(
    _id: ObjectId,
    _dataSet: ObjectId,
    _task: Option[ObjectId] = None,
    _team: ObjectId,
    _user: ObjectId,
    skeletonTracingId: Option[String],
    volumeTracingId: Option[String],
    description: String = "",
    visibility: AnnotationVisibility.Value = AnnotationVisibility.Internal,
    name: String = "",
    state: AnnotationState.Value = Active,
    statistics: JsObject = Json.obj(),
    tags: Set[String] = Set.empty,
    tracingTime: Option[Long] = None,
    typ: AnnotationType.Value = AnnotationType.Explorational,
    created: Long = System.currentTimeMillis,
    modified: Long = System.currentTimeMillis,
    isDeleted: Boolean = false
) extends FoxImplicits {

  lazy val id: String = _id.toString

  def tracingType: TracingType.Value =
    if (skeletonTracingId.isDefined && volumeTracingId.isDefined) TracingType.hybrid
    else if (skeletonTracingId.isDefined) TracingType.skeleton
    else TracingType.volume

  def isRevertPossible: Boolean =
    // Unfortunately, we can not revert all tracings, because we do not have the history for all of them
    // hence we need a way to decide if a tracing can safely be reverted. We will use the created date of the
    // annotation to do so
    created > 1470002400000L // 1.8.2016, 00:00:00

}

class AnnotationDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Annotation, AnnotationsRow, Annotations](sqlClient) {
  val collection = Annotations

  def idColumn(x: Annotations): Rep[String] = x._Id
  def isDeletedColumn(x: Annotations): Rep[Boolean] = x.isdeleted

  def parse(r: AnnotationsRow): Fox[Annotation] =
    for {
      state <- AnnotationState.fromString(r.state).toFox
      typ <- AnnotationType.fromString(r.typ).toFox
      visibility <- AnnotationVisibility.fromString(r.visibility).toFox
    } yield {
      Annotation(
        ObjectId(r._Id),
        ObjectId(r._Dataset),
        r._Task.map(ObjectId(_)),
        ObjectId(r._Team),
        ObjectId(r._User),
        r.skeletontracingid,
        r.volumetracingid,
        r.description,
        visibility,
        r.name,
        state,
        Json.parse(r.statistics).as[JsObject],
        parseArrayTuple(r.tags).toSet,
        r.tracingtime,
        typ,
        r.created.getTime,
        r.modified.getTime,
        r.isdeleted
      )
    }

  override def anonymousReadAccessQ(sharingToken: Option[String]) = s"visibility = '${AnnotationVisibility.Public}'"
  override def readAccessQ(requestingUserId: ObjectId) =
    s"""(visibility = '${AnnotationVisibility.Public}'
          or (visibility = '${AnnotationVisibility.Internal}' and (select _organization from webknossos.teams where webknossos.teams._id = _team)
            in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}'))
          or _team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}' and isTeamManager)
          or _user = '${requestingUserId.id}'
          or (select _organization from webknossos.teams where webknossos.teams._id = _team)
            in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""

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
      rList <- run(
        sql"select #$columns from #$existingCollectionName where _id = ${id.id} and #$accessQuery".as[AnnotationsRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
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
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
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

  // Does not use access query (because they dont support prefixes). Use only after separate access check!
  def findAllFinishedForProject(projectId: ObjectId): Fox[List[Annotation]] =
    for {
      r <- run(
        sql"""select #${columnsWithPrefix("a.")} from #$existingCollectionName a
                     join webknossos.tasks_ t on a._task = t._id
                     where t._project = ${projectId.id} and a.typ = '#${AnnotationType.Task.toString}' and a.state = '#${AnnotationState.Finished.toString}'"""
          .as[AnnotationsRow])
      parsed <- Fox.combined(r.toList.map(parse))
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
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findOneByTracingId(tracingId: String)(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #$columns from #$existingCollectionName where (skeletonTracingId = $tracingId or volumeTracingId = $tracingId) and #$accessQuery"
          .as[AnnotationsRow])
      r <- rList.headOption.toFox
      parsed <- parse(r)
    } yield {
      parsed
    }

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

  def insertOne(a: Annotation): Fox[Unit] =
    for {
      _ <- run(sqlu"""
               insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, skeletonTracingId, volumeTracingId, description, visibility, name, state, statistics, tags, tracingTime, typ, created, modified, isDeleted)
               values(${a._id.id}, ${a._dataSet.id}, ${a._task
        .map(_.id)}, ${a._team.id}, ${a._user.id}, ${a.skeletonTracingId},
                   ${a.volumeTracingId}, ${a.description}, '#${a.visibility.toString}', ${a.name}, '#${a.state.toString}', '#${sanitize(
        a.statistics.toString)}',
                   '#${writeArrayTuple(a.tags.toList.map(sanitize))}', ${a.tracingTime}, '#${a.typ.toString}', ${new java.sql.Timestamp(
        a.created)},
                   ${new java.sql.Timestamp(a.modified)}, ${a.isDeleted})
               """)
    } yield ()

  def updateInitialized(a: Annotation): Fox[Unit] =
    for {
      _ <- run(sqlu"""
             update webknossos.annotations
             set
               _dataSet = ${a._dataSet.id},
               _team = ${a._team.id},
               _user = ${a._user.id},
               skeletonTracingId = ${a.skeletonTracingId},
               volumeTracingId = ${a.volumeTracingId},
               description = ${a.description},
               visibility = '#${a.visibility.toString}',
               name = ${a.name},
               state = '#${a.state.toString}',
               statistics = '#${sanitize(a.statistics.toString)}',
               tags = '#${writeArrayTuple(a.tags.toList.map(sanitize))}',
               tracingTime = ${a.tracingTime},
               typ = '#${a.typ.toString}',
               created = ${new java.sql.Timestamp(a.created)},
               modified = ${new java.sql.Timestamp(a.modified)},
               isDeleted = ${a.isDeleted}
             where _id = ${a._id.id}
          """)
      _ = logger.info(s"Initialized task annotation ${a._id}, state is now ${a.state.toString}")
    } yield ()

  def abortInitializingAnnotation(id: ObjectId): Fox[Unit] =
    for {
      _ <- run(
        sqlu"delete from webknossos.annotations where _id = ${id.id} and state = '#${AnnotationState.Initializing.toString}'"
          .withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
      _ = logger.info(s"Aborted initializing task annotation ${id.toString}")
    } yield ()

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
      _ <- run(
        sqlu"update webknossos.annotations set tags = '#${writeArrayTuple(tags.map(sanitize))}' where _id = ${id.id}")
    } yield ()

  def updateModified(id: ObjectId, modified: Long)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(
        sqlu"update webknossos.annotations set modified = ${new java.sql.Timestamp(modified)} where _id = ${id.id}")
    } yield ()

  def updateSkeletonTracingId(id: ObjectId, newSkeletonTracingId: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set skeletonTracingId = $newSkeletonTracingId where _id = ${id.id}")
    } yield ()

  def updateVolumeTracingId(id: ObjectId, newVolumeTracingId: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set volumeTracingId = $newVolumeTracingId where _id = ${id.id}")
    } yield ()

  def updateStatistics(id: ObjectId, statistics: JsObject)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(
        sqlu"update webknossos.annotations set statistics = '#${sanitize(statistics.toString)}' where _id = ${id.id}")
    } yield ()

  def updateUser(id: ObjectId, userId: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    updateObjectIdCol(id, _._User, userId)
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
