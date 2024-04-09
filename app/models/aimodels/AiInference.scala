package models.aimodels

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Aiinferences, AiinferencesRow}
import models.dataset.{DataStoreDAO, DataStoreService}
import models.job.{JobDAO, JobService}
import models.user.{UserDAO, UserService}
import play.api.libs.json.{JsObject, Json}
import slick.lifted.Rep
import utils.ObjectId
import utils.sql.{SQLDAO, SqlClient, SqlToken}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AiInference(_id: ObjectId,
                       _organization: ObjectId,
                       _aiModel: ObjectId,
                       _dataset: Option[ObjectId],
                       _annotation: ObjectId,
                       _inferenceJob: ObjectId,
                       newSegmentationLayerName: String,
                       maskAnnotationLayerName: Option[String],
                       created: Instant = Instant.now,
                       modified: Instant = Instant.now,
                       isDeleted: Boolean = false)

class AiInferenceService @Inject()(dataStoreDAO: DataStoreDAO,
                                   dataStoreService: DataStoreService,
                                   aiModelService: AiModelService,
                                   aiModelDAO: AiModelDAO,
                                   userDAO: UserDAO,
                                   userService: UserService,
                                   jobDAO: JobDAO,
                                   jobService: JobService) {

  def publicWrites(aiInference: AiInference)(implicit ec: ExecutionContext, ctx: DBAccessContext): Fox[JsObject] =
    for {
      inferenceJob <- jobDAO.findOne(aiInference._inferenceJob)
      inferenceJobJs <- jobService.publicWrites(inferenceJob)
      dataStore <- dataStoreDAO.findOneByName(inferenceJob._dataStore)
      dataStoreJs <- dataStoreService.publicWrites(dataStore)
      // aiModel <- aiModelDAO.findOne(aiInference._aiModel)
      // aiModelJs <- aiModelService.publicWrites(aiModel)
      user <- userDAO.findOne(inferenceJob._owner)
      userJs <- userService.compactWrites(user)
    } yield
      Json.obj(
        "id" -> aiInference._id,
        "dataStore" -> dataStoreJs,
        "newSegmentationLayerName" -> aiInference.newSegmentationLayerName,
        "maskAnnotationLayerName" -> aiInference.maskAnnotationLayerName,
        "inferenceJob" -> inferenceJobJs,
        // "aiModel" -> aiModelJs,
        "user" -> userJs,
        "created" -> aiInference.created
      )
}

class AiInferenceDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AiInference, AiinferencesRow, Aiinferences](sqlClient) {

  protected val collection = Aiinferences

  protected def idColumn(x: Aiinferences): Rep[String] = x._Id

  protected def isDeletedColumn(x: Aiinferences): Rep[Boolean] = x.isdeleted

  protected def parse(r: AiinferencesRow): Fox[AiInference] =
    Fox.successful(
      AiInference(
        ObjectId(r._Id),
        ObjectId(r._Organization),
        ObjectId(r._Aimodel),
        r._Dataset.map(ObjectId(_)),
        ObjectId(r._Annotation),
        ObjectId(r._Inferencejob),
        r.newsegmentationlayername,
        r.maskannotationlayername,
        Instant.fromSql(r.created),
        Instant.fromSql(r.modified),
        r.isdeleted
      ))

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
      _ <- run(q"""INSERT INTO webknossos.aiInferences(
                    _id, _organization, _aiModel, _dataset, _annotation, _inferenceJob,
                     newSegmentationLayerName, maskAnnotationLayerName, created, modified, isDeleted)
                 VALUES(${a._id}, ${a._organization}, ${a._aiModel}, ${a._dataset}, ${a._annotation}, ${a._inferenceJob},
                        ${a.newSegmentationLayerName}, ${a.maskAnnotationLayerName}, ${a.created}, ${a.modified}, ${a.isDeleted})""".asUpdate)
    } yield ()

}
