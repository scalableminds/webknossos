
import brainflight.tools.geometry.Scale
import brainflight.tools.geometry.Point3D
import models.tracing.TracingSettings
import models.tracing.TracingLike
import models.tracing.TracingType
import models.tracing.Tracing
import nml._
import nml.utils._

object CompundTracing {

  def createFromTracings(tracings: List[Tracing], id: String): TemporaryTracing = {
    //TemporaryTracing(id)

    ???
  }
}

case class TemporaryTracing(
    id: String,
    dataSetName: String,
    trees: List[TreeLike],
    branchPoints: List[BranchPoint],
    timestamp: Long,
    activeNodeId: Int,
    scale: Scale,
    editPosition: Point3D,
    comments: List[Comment] = Nil,
    tracingSettings: TracingSettings = TracingSettings.default,
    tracingType: TracingType.Value = TracingType.Temporary,
    version: Int = 0) extends TracingLike[TemporaryTracing] {
  
  def task = None

  def insertTree(tree: TreeLike): TemporaryTracing = {
    this.copy(trees = tree :: trees)
  }

  def insertBranchPoint(bp: BranchPoint) =
    this.copy(branchPoints = bp :: this.branchPoints)

  def insertComment(c: Comment) =
    this.copy(comments = c :: this.comments)
}