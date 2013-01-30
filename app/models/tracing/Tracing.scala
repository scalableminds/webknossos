package models.tracing

import brainflight.tools.geometry.Point3D
import com.mongodb.casbah.commons.MongoDBObject
import org.bson.types.ObjectId
import play.api.libs.json._
import play.api.data.validation.ValidationError
import xml.Xml
import xml.XMLWrites
import models.binary.DataSet
import DBTree.DBTreeFormat
import nml.Comment
import models.user.User
import brainflight.tools.geometry.Scale
import java.util.Date
import com.mongodb.casbah.query._
import models.tracing.TracingState._
import nml.NMLParser
import models.task._
import models.Color
import models.basics._
import nml._
import play.api.Logger
import com.mongodb.casbah.commons.MongoDBList

case class Tracing(
    _user: ObjectId,
    dataSetName: String,
    branchPoints: List[BranchPoint],
    timestamp: Long,
    activeNodeId: Int,
    scale: Scale,
    editPosition: Point3D,
    comments: List[Comment] = Nil,
    _task: Option[ObjectId] = None,
    state: TracingState = InProgress,
    review: List[TracingReview] = Nil,
    tracingType: TracingType.Value = TracingType.Explorational,
    tracingSettings: TracingSettings = TracingSettings.default,
    version: Int = 0,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[Tracing] {

  def dao = Tracing
  /**
   * Easy access methods
   */
  def user = User.findOneById(_user)

  val date = new Date(timestamp)

  lazy val id = _id.toString

  def task = _task flatMap Task.findOneById

  /**
   * Tree modification
   */
  def trees = DBTree.findAllWithTracingId(_id).toList

  def tree(treeId: Int) = DBTree.findOneWithTreeId(_id, treeId)

  def maxNodeId = DBTree.maxNodeId(this.trees)

  /**
   * State modifications
   * always return a new instance!
   */
  def unassignReviewer =
    this.copy(
      state = ReadyForReview,
      review = if (this.review.isEmpty) Nil else review.tail)

  def finishReview(comment: String) = {
    val alteredReview = this.review match {
      case head :: tail =>
        head.copy(comment = Some(comment)) :: tail
      case _ =>
        Nil
    }
    this.copy(review = alteredReview)
  }
  
  def cancel = {
    task.map( _.update(_.unassigneOnce))
    this.copy(state = Unassigned)
  }

  def finish = {
    this.copy(state = Finished)
  }

  def passToReview = {
    this.copy(state = ReadyForReview)
  }

  def assignReviewer(user: User, reviewTracing: Tracing) =
    this.copy(
      state = InReview,
      review = TracingReview(
        user._id,
        reviewTracing._id,
        System.currentTimeMillis()) :: this.review)

  def reopen = {
    this.copy(state = InProgress)
  }

  def removeTask = {
    this.copy(_task = None, tracingType = TracingType.Orphan)
  }
}

object Tracing extends BasicDAO[Tracing]("tracings") {
  def tracingBase(task: Task, userId: ObjectId, dataSetName: String): Tracing =
    Tracing(userId,
      dataSetName,
      Nil,
      System.currentTimeMillis,
      1,
      Scale(12, 12, 24),
      Point3D(0, 0, 0),
      tracingSettings = task.tracingSettings,
      _task = Some(task._id),
      tracingType = TracingType.TracingBase)

  def updateFromJson(jsUpdates: Seq[JsValue], oldTracing: Tracing): Option[Tracing] = {
    val updates = jsUpdates.flatMap { TracingUpdater.createUpdateFromJson }
    if (jsUpdates.size == updates.size) {
      val tracing = updates.foldLeft(oldTracing) {
        case (tracing, updater) => updater.update(tracing)
      }
      Tracing.save(tracing.copy(timestamp = System.currentTimeMillis, version = tracing.version + 1))
      Some(tracing)
    } else {
      None
    }
  }

  def createTracingBase(task: Task, userId: ObjectId, dataSetName: String, start: Point3D) = {
    val tracing = insertOne(tracingBase(task, userId, dataSetName).copy(editPosition = start))
    val tree = Tree(1, List(Node(1, start)), Nil, Color.RED)
    DBTree.insertOne(tracing._id, tree)
    tracing
  }

  def createTracingBase(task: Task, userId: ObjectId, nml: NML) = {
    val tracing = insertOne(fromNML(userId, nml).copy(
      tracingType = TracingType.TracingBase,
      tracingSettings = task.tracingSettings, _task = Some(task._id)))

    nml.trees.map(tree => DBTree.insertOne(tracing._id, tree))
    tracing
  }

  def createReviewFor(sample: Tracing, training: Tracing, user: User) = {
    val reviewTracing = createAndInsertDeepCopy(training.copy(
      _user = user._id,
      state = TracingState.Assigned,
      timestamp = System.currentTimeMillis,
      tracingType = TracingType.Review))

    DBTree.cloneAndAddTrees(sample._id, reviewTracing._id)

    reviewTracing
  }

  def createTracingFor(user: User, task: Task) = {
    task.tracingBase.map { tracingBase =>
      task.update(_.assigneOnce)

      createAndInsertDeepCopy(tracingBase.copy(
        _user = user._id,
        timestamp = System.currentTimeMillis,
        state = InProgress,
        tracingType = TracingType.Task))
    }
  }

  def freeTacingsOfUser(userId: ObjectId) = {
    find(MongoDBObject(
      "_user" -> userId,
      "state.isFinished" -> false,
      "tracingType" -> TracingType.Task.toString))
      .toList
      .flatMap(_._task.flatMap(Task.findOneById))
      .map(_.update(_.unassigneOnce))

    update(
      MongoDBObject(
        "_user" -> userId,
        "tracingType" -> MongoDBObject("$in" -> TracingType.UserTracings.map(_.toString))),
      MongoDBObject(
        "$set" -> MongoDBObject(
          "state.isAssigned" -> false)))
  }

  def createAndInsertDeepCopy(source: Tracing) = {
    val tracing = insertOne(source.copy(_id = new ObjectId))
    DBTree.findAllWithTracingId(source._id).map(tree => DBTree.createAndInsertDeepCopy(tree, tracing._id, 0))
    tracing
  }

  def createSample(taskId: ObjectId, tracing: Tracing) = {
    createAndInsertDeepCopy(tracing.copy(
      tracingType = TracingType.Sample,
      _task = Some(taskId)))
  }

  def fromNML(userId: ObjectId, nml: NML) = {
    Tracing(
      userId,
      nml.dataSetName,
      nml.branchPoints,
      System.currentTimeMillis,
      nml.activeNodeId,
      nml.scale,
      nml.editPosition,
      nml.comments)
  }

  def createFromNMLFor(userId: ObjectId, nml: NML, tracingType: TracingType.Value) = {
    val tracing = insertOne(fromNML(userId, nml).copy(
      tracingType = tracingType))

    nml.trees.map(tree => DBTree.insertOne(tracing._id, tree))
    tracing
  }

  def assignReviewee(trainingsTracing: Tracing, user: User): Option[Tracing] = {
    for {
      task <- trainingsTracing.task
      sampleId <- task.training.map(_.sample)
      sample <- Tracing.findOneById(sampleId)
    } yield {
      val reviewTracing = createReviewFor(sample, trainingsTracing, user)
      trainingsTracing.update(_.assignReviewer(user, reviewTracing))
    }
  }

  def createTracingFor(u: User, d: DataSet = DataSet.default) = {
    val tracing = insertOne(Tracing(u._id,
      d.name,
      Nil,
      System.currentTimeMillis,
      1,
      Scale(12, 12, 24),
      Point3D(0, 0, 0),
      state = InProgress,
      tracingType = TracingType.Explorational))

    DBTree.createEmptyTree(tracing._id)
    tracing
  }

  def findTrainingForReviewTracing(tracing: Tracing) =
    findOne(MongoDBObject("review.reviewTracing" -> tracing._id))

  /*def findOpenTrainingFor(user: User) =
    findOne(MongoDBObject("_user" -> user._id, "state.isFinished" -> false, "tracingType" -> "Training"))
*/
  def hasOpenTracing(user: User, tracingType: TracingType.Value) =
    !findOpenTracingsFor(user, tracingType).isEmpty

  def findFor(u: User) =
    find(MongoDBObject(
      "_user" -> u._id,
      "state.isAssigned" -> true)).toList

  def findOpenTracingFor(user: User, tracingType: TracingType.Value) =
    findOpenTracingsFor(user, tracingType).headOption

  def findOpenTracingsFor(user: User, tracingType: TracingType.Value) =
    find(MongoDBObject(
      "_user" -> user._id,
      "state.isFinished" -> false,
      "state.isAssigned" -> true,
      "tracingType" -> tracingType.toString())).toList

  def findOpen(tracingType: TracingType.Value) =
    find(MongoDBObject(
      "state.isFinished" -> false,
      "state.isAssigned" -> true,
      "tracingType" -> tracingType.toString)).toList

  override def remove(tracing: Tracing) = {
    UsedTracings.removeAll(tracing)
    DBTree.removeAllWithTracingId(tracing._id)
    super.remove(tracing)
  }

  def removeAllWithTaskId(tid: ObjectId) =
    remove(MongoDBObject("_task" -> tid))

  def findByTaskId(tid: ObjectId) =
    find(MongoDBObject("_task" -> tid)).toList

  def findByTaskIdAndType(tid: ObjectId, tracingType: TracingType.Value) =
    find(MongoDBObject(
      "_task" -> tid,
      "tracingType" -> tracingType.toString,
      "$or" -> MongoDBList(
          "state.isAssigned" -> true,
          "state.isFinished" -> true))).toList

  implicit object TracingXMLWrites extends XMLWrites[Tracing] {
    def writes(e: Tracing) = {
      (DataSet.findOneByName(e.dataSetName).map { dataSet =>
        <things>
          <parameters>
            <experiment name={ dataSet.name }/>
            <scale x={ e.scale.x.toString } y={ e.scale.y.toString } z={ e.scale.z.toString }/>
            <offset x="0" y="0" z="0"/>
            <time ms={ e.timestamp.toString }/>
            <activeNode id={ e.activeNodeId.toString }/>
            <editPosition x={ e.editPosition.x.toString } y={ e.editPosition.y.toString } z={ e.editPosition.z.toString }/>
          </parameters>
          { e.trees.map(t => Xml.toXML(t)) }
          <branchpoints>
            { e.branchPoints.map(BranchPoint.toXML) }
          </branchpoints>
          <comments>
            { e.comments.map(c => Xml.toXML(c)) }
          </comments>
        </things>
      }) getOrElse (<error>DataSet not fount</error>)
    }
  }

  implicit object TracingWrites extends Writes[Tracing] {
    val ID = "id"
    val VERSION = "version"
    val TREES = "trees"
    val ACTIVE_NODE = "activeNode"
    val BRANCH_POINTS = "branchPoints"
    val EDIT_POSITION = "editPosition"
    val SCALE = "scale"
    val COMMENTS = "comments"
    val TRACING_TYPE = "tracingType"
    val SETTINGS = "settings"

    def writes(e: Tracing) = Json.obj(
      ID -> e.id,
      SETTINGS -> e.tracingSettings,
      TREES -> e.trees,
      VERSION -> e.version,
      TREES -> e.trees.map(DBTreeFormat.writes),
      ACTIVE_NODE -> e.activeNodeId,
      BRANCH_POINTS -> e.branchPoints,
      SCALE -> e.scale,
      COMMENTS -> e.comments,
      EDIT_POSITION -> e.editPosition,
      TRACING_TYPE -> e.tracingType.toString)

    /*def reads(js: JsValue): Tracing = {

      val id = (js \ ID).as[String]
      val version = (js \ VERSION).as[Int]
      val trees = (js \ TREES).as[List[Tree]]
      val comments = (js \ COMMENTS).as[List[Comment]]
      val activeNode = (js \ ACTIVE_NODE).as[Int]
      val branchPoints = (js \ BRANCH_POINTS).as[List[BranchPoint]]
      val editPosition = (js \ EDIT_POSITION).as[Point3D]
      Tracing.findOneById(id) match {
        case Some(exp) =>
          JsSuccess(exp.copy(trees = trees, version = version, activeNodeId = activeNode, branchPoints = branchPoints, editPosition = editPosition, comments = comments))
        case _ =>
          JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.expected.objectid"))))
      }
    }*/
  }
}
