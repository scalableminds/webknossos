package models.aimodels

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Aimodels, AimodelsRow}
import play.api.libs.json.{JsObject, Json}
import slick.lifted.Rep
import utils.ObjectId
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AiModel(_id: ObjectId)

class AiModelService @Inject()() {
  def publicWrites(aiModel: AiModel)(implicit ec: ExecutionContext): Fox[JsObject] =
    Fox.successful(Json.obj("id" -> aiModel._id))
}

class AiModelDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[AiModel, AimodelsRow, Aimodels](sqlClient) {
  protected val collection = Aimodels

  protected def idColumn(x: Aimodels): Rep[String] = x._Id

  protected def isDeletedColumn(x: Aimodels): Rep[Boolean] = x.isdeleted

  protected def parse(r: AimodelsRow): Fox[AiModel] = Fox.successful(AiModel(ObjectId(r._Id)))

}
