package models.aimodels

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Aimodels, AimodelsRow}
import models.aimodels.AiModelCategory.AiModelCategory
import models.dataset.{DataStoreDAO, DataStoreService}
import models.job.{JobDAO, JobService}
import models.user.{UserDAO, UserService}
import play.api.libs.json.{JsObject, Json}
import slick.dbio.{DBIO, Effect, NoStream}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import slick.sql.SqlAction
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AiModel(_id: ObjectId,
                   _organization: String,
                   _dataStore: String,
                   _user: ObjectId,
                   _trainingJob: Option[ObjectId],
                   _trainingAnnotations: List[ObjectId],
                   name: String,
                   comment: Option[String],
                   category: Option[AiModelCategory],
                   created: Instant = Instant.now,
                   modified: Instant = Instant.now,
                   isDeleted: Boolean = false)

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
        "trainingJob" -> trainingJobJsOpt,
        "created" -> aiModel.created
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
        r._Organization,
        r._Datastore.trim,
        ObjectId(r._User),
        r._Trainingjob.map(ObjectId(_)),
        trainingAnnotationIds,
        r.name,
        r.comment,
        r.category.flatMap(AiModelCategory.fromString),
        Instant.fromSql(r.created),
        Instant.fromSql(r.modified),
        r.isdeleted
      )

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"_organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId)"

  override def findAll(implicit ctx: DBAccessContext): Fox[List[AiModel]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[AimodelsRow])
      parsed <- parseAll(r)
    } yield parsed

  def countByNameAndOrganization(aiModelName: String, organizationId: String): Fox[Int] =
    for {
      countList <- run(
        q"SELECT COUNT(*) FROM webknossos.aiModels WHERE name = $aiModelName AND _organization = $organizationId"
          .as[Int])
      count <- countList.headOption
    } yield count

  def insertOne(a: AiModel): Fox[Unit] = {
    val insertModelQuery =
      q"""INSERT INTO webknossos.aiModels(
                      _id, _organization, _dataStore, _user, _trainingJob, name,
                       comment, category, created, modified, isDeleted
                    ) VALUES(
                      ${a._id}, ${a._organization}, ${a._dataStore}, ${a._user}, ${a._trainingJob}, ${a.name},
                      ${a.comment}, ${a.category}, ${a.created}, ${a.modified}, ${a.isDeleted}
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

  def updateOne(a: AiModel): Fox[Unit] =
    for {
      _ <- run(
        q"UPDATE webknossos.aiModels SET name = ${a.name}, comment = ${a.comment}, modified = ${a.modified} WHERE _id = ${a._id}".asUpdate)
    } yield ()

  def findOneByName(name: String)(implicit ctx: DBAccessContext): Fox[AiModel] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE name = $name AND $accessQuery".as[AimodelsRow])
      parsed <- parseFirst(r, name)
    } yield parsed

}
