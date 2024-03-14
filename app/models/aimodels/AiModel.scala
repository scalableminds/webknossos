package models.aimodels

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Aimodels, AimodelsRow}
import models.dataset.{DataStoreDAO, DataStoreService}
import models.job.{JobDAO, JobService}
import models.user.{UserDAO, UserService}
import play.api.libs.json.{JsObject, Json}
import slick.dbio.{DBIO, Effect, NoStream}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import slick.sql.SqlAction
import utils.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AiModel(_id: ObjectId,
                   _organization: ObjectId,
                   _dataStore: String,
                   _user: ObjectId,
                   _trainingJob: Option[ObjectId],
                   _trainingAnnotations: List[ObjectId],
                   name: String,
                   comment: String,
                   created: Instant,
                   modified: Instant,
                   isDeleted: Boolean)

class AiModelService @Inject()(dataStoreDAO: DataStoreDAO,
                               dataStoreService: DataStoreService,
                               userDAO: UserDAO,
                               userService: UserService,
                               jobDAO: JobDAO,
                               jobService: JobService) {
  def publicWrites(aiModel: AiModel)(implicit ec: ExecutionContext, ctx: DBAccessContext): Fox[JsObject] =
    for {
      dataStore <- dataStoreDAO.findOneByName(aiModel._dataStore)
      user <- userDAO.findOne(aiModel._user)
      userJs <- userService.compactWrites(user)
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      trainingJobOpt <- Fox.runOptional(aiModel._trainingJob)(jobDAO.findOne)
      trainingJobJsOpt <- Fox.runOptional(trainingJobOpt)(jobService.publicWrites)
    } yield
      Json.obj(
        "id" -> aiModel._id,
        "name" -> aiModel.name,
        "dataStore" -> dataStoreJs,
        "user" -> userJs,
        "comment" -> aiModel.comment,
        "created" -> aiModel.created,
        "trainingJob" -> trainingJobJsOpt
      )
}

class AiModelDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AiModel, AimodelsRow, Aimodels](sqlClient) {

  protected val collection = Aimodels

  protected def idColumn(x: Aimodels): Rep[String] = x._Id

  protected def isDeletedColumn(x: Aimodels): Rep[Boolean] = x.isdeleted

  protected def parse(r: AimodelsRow): Fox[AiModel] =
    for {
      trainingAnnotationIds <- findTrainingAnnotationIdsFor(ObjectId(r._Id))
    } yield
      AiModel(
        ObjectId(r._Id),
        ObjectId(r._Organization),
        r._Datastore.trim,
        ObjectId(r._User),
        r._Trainingjob.map(ObjectId(_)),
        trainingAnnotationIds,
        r.name,
        r.comment,
        Instant.fromSql(r.created),
        Instant.fromSql(r.modified),
        r.isdeleted
      )

  def insertOne(a: AiModel): Fox[Unit] = {
    val insertModelQuery =
      q"""INSERT INTO webknossos.aiModels(
                      _id, _organization, _dataStore, _user, _trainingJob, name,
                       comment, created, modified, isDeleted
                    ) VALUES(
                      ${a._id}, ${a._organization}, ${a._dataStore}, ${a._user}, ${a._trainingJob}, ${a.name},
                      ${a.comment}, ${a.created}, ${a.modified}, ${a.isDeleted}
                    )
           """.asUpdate
    val insertTrainingAnnotationQueries = insertTrainingAnnotationIdQueries(a._id, a._trainingAnnotations)
    for {
      _ <- run(DBIO.sequence(insertModelQuery +: insertTrainingAnnotationQueries).transactionally)
    } yield ()
  }

  private def insertTrainingAnnotationIdQueries(aiModelId: ObjectId,
                                                annotationIds: List[ObjectId]): List[SqlAction[Int, NoStream, Effect]] =
    annotationIds.map { annotationId =>
      insertTrainingAnnotationIdQuery(aiModelId, annotationId)
    }

  private def insertTrainingAnnotationIdQuery(aiModelId: ObjectId,
                                              annotationId: ObjectId): SqlAction[Int, NoStream, Effect] =
    q"""INSERT INTO webknossos.aiModel_trainingAnnotations(_aiModel, _annotation)
            VALUES($aiModelId, $annotationId)""".asUpdate

  private def findTrainingAnnotationIdsFor(aiModelId: ObjectId): Fox[List[ObjectId]] =
    for {
      rows <- run(
        q"SELECT _annotation FROM webknossos.aiModel_trainingAnnotations WHERE _aiModel = $aiModelId ORDER BY _annotation"
          .as[ObjectId])
    } yield rows.toList
}
