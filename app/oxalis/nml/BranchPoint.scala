package oxalis.nml
import play.api.libs.json.Json
import play.api.libs.json.JsValue
import play.api.libs.json.Format
import play.api.libs.json._
import play.api.data.validation.ValidationError
import braingames.xml.XMLWrites

case class BranchPoint(id: Int)

object BranchPoint {
  val ID = "id"
  val TREE_ID = "treeId"
  implicit object BranchPointReads extends Reads[BranchPoint] {
    // TODO: rewrite
    def reads(json: JsValue) = (json \ ID) match {
      case JsNumber(n) => JsSuccess(BranchPoint(n.toInt))
      case _           => JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.expected.jsnumber"))))
    }
  }

  implicit object BranchPointJsonWrites extends Writes[BranchPoint] {

    def writes(b: BranchPoint) = Json.obj(
      ID -> b.id)
  }

  implicit object BranchPointXMLWrites extends XMLWrites[BranchPoint] {
    def writes(b: BranchPoint) =
      <branchpoint id={ b.id.toString }/>
  }
}