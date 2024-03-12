package models.aimodels

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Aimodels, AimodelsRow}
import play.api.libs.json.{JsObject, Json}
import slick.lifted.Rep
import utils.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AiModel(_id: ObjectId,
                   _organization: ObjectId,
                   _dataStore: String,
                   _user: ObjectId,
                   _trainingJob: Option[ObjectId],
                   name: String,
                   comment: String,
                   created: Instant,
                   modified: Instant,
                   isDeleted: Boolean)

class AiModelService @Inject()() {
  def publicWrites(aiModel: AiModel)(implicit ec: ExecutionContext): Fox[JsObject] =
    Fox.successful(Json.obj("id" -> aiModel._id))
}

class AiModelDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AiModel, AimodelsRow, Aimodels](sqlClient) {

  protected val collection = Aimodels

  protected def idColumn(x: Aimodels): Rep[String] = x._Id

  protected def isDeletedColumn(x: Aimodels): Rep[Boolean] = x.isdeleted

  protected def parse(r: AimodelsRow): Fox[AiModel] = Fox.successful(
    AiModel(
      ObjectId(r._Id),
      ObjectId(r._Organization),
      r._Datastore.trim,
      ObjectId(r._User),
      r._Trainingjob.map(ObjectId(_)),
      r.name,
      r.comment,
      Instant.fromSql(r.created),
      Instant.fromSql(r.modified),
      r.isdeleted
    )
  )

  def insertOne(a: AiModel): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.aiModels(
                  _id, _organization, _dataStore, _user, _trainingJob, name,
                   comment, created, modified, isDeleted
                ) VALUES(
                  ${a._id}, ${a._organization}, ${a._dataStore}, ${a._user}, ${a._trainingJob}, ${a.name},
                  ${a.comment}, ${a.created}, ${a.modified}, ${a.isDeleted}
                )
       """.asUpdate)
    } yield ()

}
