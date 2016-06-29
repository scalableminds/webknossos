package oxalis.nml

import com.scalableminds.util.xml.SynchronousXMLWrites
import play.api.libs.json.Json

case class BranchPoint(id: Int, timestamp: Long)

object BranchPoint {
  val ID = "id"
  val TREE_ID = "treeId"

  implicit val branchPointFormat = Json.format[BranchPoint]

  implicit object BranchPointXMLWrites extends SynchronousXMLWrites[BranchPoint] {
    def synchronousWrites(b: BranchPoint) =
        <branchpoint id={b.id.toString} time={b.timestamp.toString}/>
  }

}
