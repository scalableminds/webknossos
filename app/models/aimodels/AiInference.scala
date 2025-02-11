package models.aimodels

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.BoundingBox
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Aiinferences, AiinferencesRow, GetResultAiinferencesRow}
import models.dataset.{DataStoreDAO, DataStoreService, DatasetDAO, DatasetService}
import models.job.{JobDAO, JobService}
import models.user.{User, UserDAO, UserService}
import play.api.libs.json.{JsObject, Json}
import slick.lifted.Rep
import com.scalableminds.util.objectid.ObjectId
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AiInference(
    _id: ObjectId,
    _organization: String,
    _aiModel: ObjectId,
    _newDataset: Option[ObjectId],
    _annotation: Option[ObjectId],
    boundingBox: BoundingBox,
    _inferenceJob: ObjectId,
    newSegmentationLayerName: String,
    maskAnnotationLayerName: Option[String],
    created: Instant = Instant.now,
    modified: Instant = Instant.now,
    isDeleted: Boolean = false
)

class AiInferenceService @Inject() (
    dataStoreDAO: DataStoreDAO,
    dataStoreService: DataStoreService,
    aiModelService: AiModelService,
    aiModelDAO: AiModelDAO,
    datasetDAO: DatasetDAO,
    userDAO: UserDAO,
    userService: UserService,
    datasetService: DatasetService,
    jobDAO: JobDAO,
    jobService: JobService
) {

  def publicWrites(aiInference: AiInference, requestingUser: User)(implicit
      ctx: DBAccessContext,
      ec: ExecutionContext
  ): Fox[JsObject] =
    for {
      inferenceJob <- jobDAO.findOne(aiInference._inferenceJob)
      inferenceJobJs <- jobService.publicWrites(inferenceJob)
      dataStore <- dataStoreDAO.findOneByName(inferenceJob._dataStore)
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      aiModel <- aiModelDAO.findOne(aiInference._aiModel)
      aiModelJs <- aiModelService.publicWrites(aiModel)
      newDatasetOpt <- Fox.runOptional(aiInference._newDataset)(datasetDAO.findOne)
      newDatasetJsOpt <- Fox.runOptional(newDatasetOpt)(newDataset =>
        datasetService.publicWrites(newDataset, Some(requestingUser))
      )
      user <- userDAO.findOne(inferenceJob._owner)
      userJs <- userService.compactWrites(user)
    } yield Json.obj(
      "id" -> aiInference._id,
      "dataStore" -> dataStoreJs,
      "newSegmentationLayerName" -> aiInference.newSegmentationLayerName,
      "maskAnnotationLayerName" -> aiInference.maskAnnotationLayerName,
      "inferenceJob" -> inferenceJobJs,
      "aiModel" -> aiModelJs,
      "user" -> userJs,
      "newDataset" -> newDatasetJsOpt,
      "created" -> aiInference.created
    )
}

class AiInferenceDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AiInference, AiinferencesRow, Aiinferences](sqlClient) {

  protected val collection = Aiinferences

  protected def idColumn(x: Aiinferences): Rep[String] = x._Id

  protected def isDeletedColumn(x: Aiinferences): Rep[Boolean] = x.isdeleted

  protected def getResult = GetResultAiinferencesRow

  protected def parse(r: AiinferencesRow): Fox[AiInference] =
    for {
      boundingBox <- BoundingBox.fromSQL(parseArrayLiteral(r.boundingbox).map(_.toInt)).toFox
    } yield AiInference(
      ObjectId(r._Id),
      r._Organization,
      ObjectId(r._Aimodel),
      r._Newdataset.map(ObjectId(_)),
      r._Annotation.map(ObjectId(_)),
      boundingBox,
      ObjectId(r._Inferencejob),
      r.newsegmentationlayername,
      r.maskannotationlayername,
      Instant.fromSql(r.created),
      Instant.fromSql(r.modified),
      r.isdeleted
    )

  override protected def readAccessQ(requestingUserId: ObjectId): SqlToken =
    q"_organization IN (SELECT _organization FROM webknossos.users_ WHERE _id = $requestingUserId)"

  override def findAll(implicit ctx: DBAccessContext): Fox[List[AiInference]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[AiinferencesRow])
      parsed <- parseAll(r)
    } yield parsed

  def insertOne(a: AiInference): Fox[Unit] =
    for {
      _ <- run(
        q"""INSERT INTO webknossos.aiInferences(
                    _id, _organization, _aiModel, _newDataset, _annotation, _inferenceJob, boundingBox,
                     newSegmentationLayerName, maskAnnotationLayerName, created, modified, isDeleted)
                 VALUES(${a._id}, ${a._organization}, ${a._aiModel}, ${a._newDataset}, ${a._annotation}, ${a._inferenceJob}, ${a.boundingBox},
                        ${a.newSegmentationLayerName}, ${a.maskAnnotationLayerName}, ${a.created}, ${a.modified}, ${a.isDeleted})""".asUpdate
      )
    } yield ()

  def countForModel(aiModelId: ObjectId): Fox[Long] =
    for {
      countRows <- run(q"SELECT COUNT(*) FROM webknossos.aiInferences_ WHERE _aiModel = $aiModelId".as[Long])
      count <- countRows.headOption
    } yield count

  def findOneByJobId(jobId: ObjectId): Fox[AiInference] =
    for {
      r <- run(q"SELECT $columns from $existingCollectionName WHERE _inferenceJob = $jobId".as[AiinferencesRow])
      parsed <- parseFirst(r, "find AiInference by job id")
    } yield parsed

  def updateDataset(id: ObjectId, datasetId: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"UPDATE webknossos.aiInferences SET _newDataset = $datasetId WHERE _id = $id".asUpdate)
    } yield ()

}
