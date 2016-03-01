package models.tracing.skeleton

import models.tracing.TracingStatistics
import scala.concurrent.Future
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, DBAccessContext}
import play.api.libs.json.Json

case class SkeletonTracingStatistics(
                                      numberOfNodes: Long,
                                      numberOfEdges: Long,
                                      numberOfTrees: Long
                                    ) extends TracingStatistics with FoxImplicits {

  def createTree = Future.successful(this.copy(numberOfTrees = this.numberOfTrees + 1))

  def deleteTree(tree: DBTree) = {
    for {
      nNodes <- tree.numberOfNodes
      nEdges <- tree.numberOfEdges
    } yield this.copy(
      this.numberOfNodes - nNodes,
      this.numberOfEdges - nEdges,
      this.numberOfTrees - 1
    )
  }

  def mergeTree = Future.successful(this.copy(numberOfTrees = this.numberOfTrees - 1))

  def createNode = Future.successful(this.copy(numberOfNodes = this.numberOfNodes + 1))

  def deleteNode(nodeId: Int, tree: DBTree) = {
    for {
      nEdges <- DBEdgeDAO.countEdgesOfNode(nodeId, tree._id)(GlobalAccessContext)
    } yield this.copy(
      this.numberOfNodes - 1,
      this.numberOfEdges - nEdges,
      this.numberOfTrees
    )
  }

  def createEdge = Future.successful(this.copy(numberOfEdges = this.numberOfEdges + 1))

  def deleteEdge = Future.successful(this.copy(numberOfEdges = this.numberOfEdges + 1))
}

object SkeletonTracingStatistics {
  implicit val skeletonTracingStatisticsFormat = Json.format[SkeletonTracingStatistics]
}
