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

case class Tracing(
  dataSetName: String,
  branchPoints: List[BranchPoint],
  timestamp: Long,
  activeNodeId: Int,
  scale: Scale,
  editPosition: Point3D,
  comments: List[Comment] = Nil,
  settings: AnnotationSettings = AnnotationSettings.default,
  _id: ObjectId = new ObjectId)
  extends DAOCaseClass[Tracing] with TracingLike with AnnotationContent {

  def id = _id.toString

  type Self = Tracing

  def dao = Tracing

  def makeReadOnly =
    this.copy(settings = settings.copy(isEditable = false))

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

  override def mergeWith(c: AnnotationContent): Tracing = {
    c match {
      case c: TracingLike =>
        super.mergeWith(c)
      case e =>
        throw new Exception("Can't merge Tracing with: " + e)
    }
  }

  def copyDeepAndInsert = {
    val tracing = Tracing.insertOne(this.copy(
      _id = new ObjectId,
      branchPoints = Nil,
      comments = Nil))
    Tracing.mergeWith(this, tracing)
  }

  def updateFromJson(jsUpdates: Seq[JsValue]): Option[Tracing] = {
    val updates = jsUpdates.flatMap {
      TracingUpdater.createUpdateFromJson
    }
    if (jsUpdates.size == updates.size) {
      val tracing = updates.foldLeft(this) {
        case (tracing, updater) => updater.update(tracing)
      }
      Tracing.save(tracing.copy(timestamp = System.currentTimeMillis))
      Some(tracing)
    } else {
      None
    }
  }
}

object Tracing extends BasicDAO[Tracing]("tracings") with AnnotationStatistics with AnnotationContentDAO {
  type AType = Tracing

  def tracingBase(settings: AnnotationSettings, dataSetName: String): Tracing =
    Tracing(
      dataSetName,
      Nil,
      System.currentTimeMillis,
      1,
      Scale(12, 12, 24),
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

  def createFromNML(settings: AnnotationSettings, nml: NML): Tracing = {
    val tracing = insertOne(fromNML(nml).copy(
      settings = settings))

    nml.trees.map(tree => DBTree.insertOne(tracing._id, tree))
    tracing
  }

  def fromNML(nml: NML) = {
    Tracing(
      nml.dataSetName,
      nml.branchPoints,
      System.currentTimeMillis,
      nml.activeNodeId,
      nml.scale,
      nml.editPosition,
      nml.comments)
  }

  def mergeWith(source: Tracing, target: Tracing) = {
    target.update(t => t.mergeWith(source))
  }

  def createForDataSet(d: DataSet = DataSetDAO.default) = {
    val tracing = insertOne(Tracing(
      d.name,
      Nil,
      System.currentTimeMillis,
      1,
      Scale(12, 12, 24),
      Point3D(0, 0, 0)))

    DBTree.createEmptyTree(tracing._id)
    tracing
  }

  def updateSettings(settings: AnnotationSettings, tracingId: String) = {
    withValidId(tracingId) {
      id =>
        Some(update(
          MongoDBObject("_id" -> id),
          MongoDBObject("settings" -> settings),
          false,
          false
        ))
    }
  }

  override def removeById(tracing: ObjectId, wc: com.mongodb.WriteConcern = defaultWriteConcern) = {
    UsedAnnotation.removeAll(tracing.toString)
    DBTree.removeAllWithTracingId(tracing)
    super.removeById(tracing, wc)
  }
}
