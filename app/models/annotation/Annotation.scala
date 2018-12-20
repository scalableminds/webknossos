package models.annotation

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.tracingstore.tracings.TracingType
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import models.annotation.AnnotationState._
import models.annotation.AnnotationType.AnnotationType
import play.api.libs.json._
import slick.jdbc.GetResult._
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.TransactionIsolation.Serializable
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

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
    isPublic: Boolean = false,
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

  lazy val id = _id.toString
  lazy val team = _team.toString

  def tracingType =
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
        r.ispublic,
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

  override def anonymousReadAccessQ(sharingToken: Option[String]) = "isPublic"
  override def readAccessQ(requestingUserId: ObjectId) =
    s"""(isPublic or _team in (select _team from webknossos.user_team_roles where _user = '${requestingUserId.id}') or _user = '${requestingUserId.id}'
       or (select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""
  override def deleteAccessQ(requestingUserId: ObjectId) =
    s"""(_team in (select _team from webknossos.user_team_roles where isTeamManager and _user = '${requestingUserId.id}') or _user = '${requestingUserId.id}
       or (select _organization from webknossos.teams where webknossos.teams._id = _team)
        in (select _organization from webknossos.users_ where _id = '${requestingUserId.id}' and isAdmin))"""

  // read operations

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #${columns} from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}"
          .as[AnnotationsRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  def findAllFor(userId: ObjectId,
                 isFinished: Option[Boolean],
                 annotationType: AnnotationType,
                 limit: Int,
                 pageNumber: Int = 0)(implicit ctx: DBAccessContext): Fox[List[Annotation]] = {
    val stateQuery = isFinished match {
      case Some(true)  => s"state = '${AnnotationState.Finished.toString}'"
      case Some(false) => s"state = '${AnnotationState.Active.toString}'"
      case None        => s"state != '${AnnotationState.Cancelled.toString}'"
    }
    for {
      accessQuery <- readAccessQuery
      r <- run(sql"""select #${columns} from #${existingCollectionName}
                     where _user = ${userId.id} and typ = '#${annotationType.toString}' and #${stateQuery} and #${accessQuery}
                     order by _id desc limit ${limit} offset ${pageNumber * limit}""".as[AnnotationsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed
  }

  // hint: does not use access query (because they dont support prefixes yet). use only after separate access check
  def findAllFinishedForProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        sql"""select #${columnsWithPrefix("a.")} from #${existingCollectionName} a
                     join webknossos.tasks_ t on a._task = t._id
                     where t._project = ${projectId.id} and a.typ = '#${AnnotationType.Task.toString}' and a.state = '#${AnnotationState.Finished.toString}'"""
          .as[AnnotationsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  // hint: does not use access query (because they dont support prefixes yet). use only after separate access check
  def findAllActiveForProject(projectId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[ObjectId]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(sql""" select a._id from
                        webknossos.annotations_ a
                        join webknossos.tasks_ t on a._task = t._id
                        join webknossos.projects_ p on t._project = p._id
                        join webknossos.users_ u on a._user = u._id
                        where p._id = ${projectId}
                        and a.state = '#${AnnotationState.Active.toString}'
                        and a.typ = '#${AnnotationType.Task}' """.as[String])
    } yield r.map(ObjectId(_)).toList

  def findAllByTaskIdAndType(taskId: ObjectId, typ: AnnotationType)(
      implicit ctx: DBAccessContext): Fox[List[Annotation]] =
    for {
      r <- run(Annotations
        .filter(r =>
          notdel(r) && r._Task === taskId.id && r.typ === typ.toString && r.state =!= AnnotationState.Cancelled.toString)
        .result)
      accessQuery <- readAccessQuery
      r <- run(
        sql"""select #${columns} from #${existingCollectionName}
                     where _task = ${taskId.id} and typ = '#${typ.toString}' and state != '#${AnnotationState.Cancelled.toString}' and #${accessQuery}"""
          .as[AnnotationsRow])
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def findOneByTracingId(tracingId: String)(implicit ctx: DBAccessContext): Fox[Annotation] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #${columns} from #${existingCollectionName} where (skeletonTracingId = ${tracingId} or volumeTracingId = ${tracingId}) and #${accessQuery}"
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
                                  (select #${columns}
                                   from #${existingCollectionName}
                                   where _user = ${userId.id} and typ = '#${typ.toString}' and state = '#${AnnotationState.Active.toString}' and #${accessQuery}) a
                                  join webknossos.teams t on a._team = t._id where #${excludeTeamsQ}) q
                         """.as[Int])
      count <- countList.headOption
    } yield count

  def countActiveByTask(taskId: ObjectId, typ: AnnotationType)(implicit ctx: DBAccessContext): Fox[Int] =
    for {
      accessQuery <- readAccessQuery
      countList <- run(
        sql"""select count(*) from (select _id from #${existingCollectionName} where _task = ${taskId.id} and typ = '#${typ.toString}' and state = '#${AnnotationState.Active.toString}' and #${accessQuery}) q"""
          .as[Int])
      count <- countList.headOption
    } yield count

  // update operations

  def insertOne(a: Annotation): Fox[Unit] =
    for {
      _ <- run(sqlu"""
               insert into webknossos.annotations(_id, _dataSet, _task, _team, _user, skeletonTracingId, volumeTracingId, description, isPublic, name, state, statistics, tags, tracingTime, typ, created, modified, isDeleted)
               values(${a._id.id}, ${a._dataSet.id}, ${a._task
        .map(_.id)}, ${a._team.id}, ${a._user.id}, ${a.skeletonTracingId},
                   ${a.volumeTracingId}, ${a.description}, ${a.isPublic}, ${a.name}, '#${a.state.toString}', '#${sanitize(
        a.statistics.toString)}',
                   '#${writeArrayTuple(a.tags.toList.map(sanitize(_)))}', ${a.tracingTime}, '#${a.typ.toString}', ${new java.sql.Timestamp(
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
               isPublic = ${a.isPublic},
               name = ${a.name},
               state = '#${a.state.toString}',
               statistics = '#${sanitize(a.statistics.toString)}',
               tags = '#${writeArrayTuple(a.tags.toList.map(sanitize(_)))}',
               tracingTime = ${a.tracingTime},
               typ = '#${a.typ.toString}',
               created = ${new java.sql.Timestamp(a.created)},
               modified = ${new java.sql.Timestamp(a.modified)},
               isDeleted = ${a.isDeleted}
             where _id = ${a._id.id}
          """)
    } yield ()

  def abortInitializingAnnotation(id: ObjectId): Fox[Unit] =
    for {
      _ <- run(
        sqlu"delete from webknossos.annotations where _id = ${id.id} and state = '#${AnnotationState.Initializing.toString}'"
          .withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      )
    } yield ()

  def deleteOldInitializingAnnotations: Fox[Unit] =
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

  def updateState(id: ObjectId, state: AnnotationState)(implicit ctx: DBAccessContext) =
    for {
      _ <- assertUpdateAccess(id) ?~> "FAILED: AnnotationSQLDAO.assertUpdateAccess"
      _ <- run(
        sqlu"update webknossos.annotations set state = '#${state}' where _id = ${id.id}"
          .withTransactionIsolation(Serializable),
        retryCount = 50,
        retryIfErrorContains = List(transactionSerializationError)
      ) ?~> "FAILED: run in AnnotationSQLDAO.updateState"
    } yield ()

  def updateDescription(id: ObjectId, description: String)(implicit ctx: DBAccessContext) =
    updateStringCol(id, _.description, description)

  def updateName(id: ObjectId, name: String)(implicit ctx: DBAccessContext) =
    updateStringCol(id, _.name, name)

  def updateIsPublic(id: ObjectId, isPublic: Boolean)(implicit ctx: DBAccessContext) =
    updateBooleanCol(id, _.ispublic, isPublic)

  def updateTags(id: ObjectId, tags: List[String])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(
        sqlu"update webknossos.annotations set tags = '#${writeArrayTuple(tags.map(sanitize(_)))}' where _id = ${id.id}")
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
      _ <- run(sqlu"update webknossos.annotations set skeletonTracingId = ${newSkeletonTracingId} where _id = ${id.id}")
    } yield ()

  def updateVolumeTracingId(id: ObjectId, newVolumeTracingId: String)(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.annotations set volumeTracingId = ${newVolumeTracingId} where _id = ${id.id}")
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
