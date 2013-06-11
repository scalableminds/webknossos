package models.tracing.skeleton

import braingames.geometry.Point3D
import com.mongodb.casbah.commons.MongoDBObject
import org.bson.types.ObjectId
import play.api.libs.json._
import models.binary.DataSetDAO
import models.user.UsedAnnotation
import braingames.geometry.Scale
import braingames.image.Color
import models.basics._
import oxalis.nml._
import braingames.binary.models.DataSet
import models.annotation.{AnnotationContentDAO, AnnotationSettings, AnnotationContent}
import models.tracing.CommonTracingDAO

case class SkeletonTracing(
  dataSetName: String,
  branchPoints: List[BranchPoint],
  timestamp: Long,
  activeNodeId: Int,
  editPosition: Point3D,
  comments: List[Comment] = Nil,
  settings: AnnotationSettings = AnnotationSettings.default,
  _id: ObjectId = new ObjectId)
  extends DAOCaseClass[SkeletonTracing] with SkeletonTracingLike with AnnotationContent {

  def id = _id.toString

  type Self = SkeletonTracing

  def dao = SkeletonTracing

  def allowAllModes =
    this.copy(settings = settings.copy(allowedModes = AnnotationSettings.ALL_MODES))


  /**
   * Tree modification
   */
  def trees = dbtrees.map(_.toTree)

  def dbtrees = DBTree.findAllWithTracingId(_id).toList

  def insertTree[Tracing](t: TreeLike) = {
    DBTree.insertOne(_id, t)
    this.asInstanceOf[Tracing]
  }

  def insertBranchPoint[Tracing](bp: BranchPoint) =
    this.copy(branchPoints = bp :: this.branchPoints).asInstanceOf[Tracing]

  def insertComment[Tracing](c: Comment) =
    this.copy(comments = c :: this.comments).asInstanceOf[Tracing]

  def tree(treeId: Int) = DBTree.findOneWithTreeId(_id, treeId)

  def maxNodeId = oxalis.nml.utils.maxNodeId(this.trees)

  def clearTracingData = {
    DBTree.removeAllWithTracingId(_id)
    this.update(_.copy(branchPoints = Nil, comments = Nil))
  }

  override def mergeWith(c: AnnotationContent): SkeletonTracing = {
    c match {
      case c: SkeletonTracingLike =>
        super.mergeWith(c)
      case e =>
        throw new Exception("Can't merge SkeletonTracing with: " + e)
    }
  }

  def copyDeepAndInsert = {
    val tracing = SkeletonTracing.insertOne(this.copy(
      _id = new ObjectId,
      branchPoints = Nil,
      comments = Nil))
    SkeletonTracing.mergeWith(this, tracing)
  }

  def updateFromJson(jsUpdates: Seq[JsValue]): Option[SkeletonTracing] = {
    val updates = jsUpdates.flatMap {
      TracingUpdater.createUpdateFromJson
    }
    if (jsUpdates.size == updates.size) {
      val tracing = updates.foldLeft(this) {
        case (tracing, updater) => updater.update(tracing)
      }
      SkeletonTracing.save(tracing.copy(timestamp = System.currentTimeMillis))
      Some(tracing)
    } else {
      None
    }
  }
}

object SkeletonTracing extends BasicDAO[SkeletonTracing]("skeletons") with AnnotationStatistics with AnnotationContentDAO with CommonTracingDAO{
  type AType = SkeletonTracing

  val contentType = "skeletonTracing"

  def tracingBase(settings: AnnotationSettings, dataSetName: String): SkeletonTracing =
    SkeletonTracing(
      dataSetName,
      Nil,
      System.currentTimeMillis,
      1,
      Point3D(0, 0, 0),
      settings = settings)

  def createFromStart(settings: AnnotationSettings, dataSetName: String, start: Point3D) = {
    createFromNML(
      settings,
      NML(
        dataSetName,
        List(Tree(1, Set(Node(1, start)), Set.empty, Color.RED)),
        Nil,
        System.currentTimeMillis(),
        1,
        Scale(12, 12, 24),
        start,
        Nil))
  }

  def createFromNML(settings: AnnotationSettings, nml: NML): SkeletonTracing = {
    val tracing = insertOne(fromNML(nml).copy(
      settings = settings))

    nml.trees.map(tree => DBTree.insertOne(tracing._id, tree))
    tracing
  }

  def fromNML(nml: NML) = {
    SkeletonTracing(
      nml.dataSetName,
      nml.branchPoints,
      System.currentTimeMillis,
      nml.activeNodeId,
      nml.editPosition,
      nml.comments)
  }

  def mergeWith(source: SkeletonTracing, target: SkeletonTracing) = {
    target.update(t => t.mergeWith(source))
  }

  def createForDataSet(d: DataSet) = {
    val tracing = insertOne(SkeletonTracing(
      d.name,
      Nil,
      System.currentTimeMillis,
      1,
      Point3D(0, 0, 0)))

    DBTree.createEmptyTree(tracing._id)
    tracing
  }

  override def removeById(tracing: ObjectId, wc: com.mongodb.WriteConcern = defaultWriteConcern) = {
    UsedAnnotation.removeAll(tracing.toString)
    DBTree.removeAllWithTracingId(tracing)
    super.removeById(tracing, wc)
  }
}
