package models.graph

import play.api.libs.json.Writes
import play.api.libs.json.Json
import play.api.libs.json.JsValue
import play.api.libs.json.Format
import play.api.libs.json._
import play.api.data.validation.ValidationError

case class BranchPoint(id: Int)

object BranchPoint {
  val ID = "id"
  val TREE_ID = "treeId"
  implicit object BranchPointReads extends Reads[BranchPoint] {
    // TODO: rewrite
    def reads(json: JsValue) = (json \ ID) match {
      case JsNumber(n) => JsSuccess(BranchPoint(n.toInt))
      case _ => JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.expected.jsnumber"))))
    }
  }
  
  implicit object BranchPointWrites extends Writes[BranchPoint] {

    def writes(b: BranchPoint) = Json.obj(
      ID -> b.id)
  }

  def toXML(b: BranchPoint) =
    <branchpoint id={ b.id.toString }/>
}