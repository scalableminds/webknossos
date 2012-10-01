package models

import play.api.libs.json.Writes
import play.api.libs.json.Json
import play.api.libs.json.JsValue
import play.api.libs.json.Format

case class BranchPoint(id: Int, treeId: Int)

object BranchPoint {
  implicit object BranchPointFormat extends Format[BranchPoint] {
    val ID = "id"
    val TREE_ID = "treeId"

    def writes(b: BranchPoint) = Json.obj(
      ID -> b.id,
      TREE_ID -> b.treeId)

    def reads(js: JsValue) = BranchPoint((js \ ID).as[Int], (js \ TREE_ID).as[Int])
  }

  def toXML(b: BranchPoint) =
    <branchpoint id={ b.id.toString }/>
}