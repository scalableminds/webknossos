package oxalis.nml
import play.api.libs.json.Json
import play.api.libs.json.JsValue
import play.api.libs.json.Format
import play.api.libs.json._
import play.api.data.validation.ValidationError
import braingames.xml.{SynchronousXMLWrites, XMLWrites}

case class BranchPoint(id: Int)

object BranchPoint {
  val ID = "id"
  val TREE_ID = "treeId"

  implicit val branchPointFormat = Json.format[BranchPoint]

  implicit object BranchPointXMLWrites extends SynchronousXMLWrites[BranchPoint] {
    def synchronousWrites(b: BranchPoint) =
      <branchpoint id={ b.id.toString }/>
  }
}