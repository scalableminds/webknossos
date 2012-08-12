package models

import play.api.libs.json.Writes
import play.api.libs.json.Json

case class BranchPoint(id: Int)

object BranchPoint {
  implicit object BranchPointWrites extends Writes[BranchPoint] {
    def writes(b: BranchPoint) = Json.toJson(b.id)
  }
  def toXML(b: BranchPoint) =
    <branchpoint id={ b.id.toString }/>
}