package models.tracing

import play.api.libs.json.JsValue
import play.api.libs.json.Reads
import brainflight.tools.geometry.Point3D
import com.mongodb.casbah.commons.MongoDBObject
import org.bson.types.ObjectId
import play.api.libs.json.Writes
import play.api.libs.json.Json
import play.api.libs.json.JsObject
import xml.Xml
import xml.XMLWrites
import models.binary.DataSet
import DBTree.DBTreeFormat
import nml.Comment
import models.user.User
import play.api.libs.json.Reads
import play.api.libs.json.JsValue
import play.api.libs.json.Format
import brainflight.tools.geometry.Scale
import java.util.Date
import com.mongodb.casbah.query._
import models.tracing.TracingState._
import nml.NMLParser
import models.task._
import models.basics._
import nml._
import play.api.Logger

case class Tracing(
    _user: ObjectId,
    dataSetName: String,
    _trees: List[ObjectId],
    branchPoints: List[BranchPoint],
    timestamp: Long,
    activeNodeId: Int,
    scale: Scale,
    editPosition: Point3D,
    comments: List[Comment] = Nil,
    taskId: Option[ObjectId] = None,
    state: TracingState = InProgress,
    review: List[TracingReview] = Nil,
    tracingType: TracingType.Value = TracingType.Explorational,
    version: Int = 0,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[Tracing] {

  def dao = Tracing
  /**
   * Easy access methods
   */
  def user = User.findOneById(_user)

  val date = {
    new Date(timestamp)
  }

  lazy val id = _id.toString

  def isTrainingsTracing = tracingType == TracingType.Training

  def task = taskId flatMap Task.findOneById

  def isExploratory = tracingType == TracingType.Explorational

  /**
   * Tree modification
   */
  def trees = {
    val trees = _trees.flatMap(treeOid => DBTree.findOneById(treeOid))
    if (trees.size != _trees.size)
      Logger.error("Trees are incomplete!")
    trees
  }

  def tree(treeId: Int) = DBTree.findOneWithTreeId(_trees, treeId)

  def maxNodeId = {
    DBTree.maxNodeId(this.trees)
  }

  def addEmptyTree(tree: DBTree) =
    this.copy(_trees = tree._id :: _trees)

  def removeTree(tree: DBTree) = this.copy(_trees = _trees.filterNot(_ == tree._id))

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
    this.copy(taskId = None, tracingType = TracingType.Orphan)
  }
}

object Tracing extends BasicDAO[Tracing]("tracings") {
  
  def updateFromJson(jsUpdates: Seq[JsValue], oldTracing: Tracing) : Option[Tracing] = {
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

  def createReviewFor(tracing: Tracing, training: Tracing, user: User) = {
    val trees = Tracing
      .addTrees(tracing, training.trees)
      .trees.map(DBTree.createAndInsertDeepCopy)
    tracing.copy(
      _id = new ObjectId,
      _user = user._id,
      state = TracingState.Assigned,
      _trees = trees.map(_._id),
      timestamp = System.currentTimeMillis,
      tracingType = TracingType.Review)
  }

  def addTree(tracing: Tracing, tree: DBTree) = {
    tracing.maxNodeId.map { maxId =>
      DBTree.increaseNodeIds(tree, maxId)
    }
    tracing.update(_.copy(_trees = tree._id :: tracing._trees))
  }

  def addTrees(tracing: Tracing, trees: List[DBTree]) = {
    trees.foldLeft(tracing) {
      case (tracing, tree) => addTree(tracing, tree)
    }
  }

  def createTracingFor(user: User, task: Task) = {
    val tree = DBTree.createEmptyTree
    insertOne(Tracing(user._id,
      task.dataSetName,
      List(tree._id),
      Nil,
      System.currentTimeMillis,
      1,
      Scale(12, 12, 24),
      task.start,
      taskId = Some(task._id),
      tracingType =
        if (task.isTraining) TracingType.Training
        else TracingType.Task))
  }

  def createFromNMLFor(user: User, nml: NML, tracingType: TracingType.Value) = {
    val trees = nml.trees.map(t => DBTree.insertOne(t))
    insertOne(Tracing(
      user._id,
      nml.dataSetName,
      trees.map(_._id),
      nml.branchPoints,
      nml.timeStamp,
      nml.activeNodeId,
      nml.scale,
      nml.editPosition,
      nml.comments,
      tracingType = tracingType))
  }

  override def remove(tracing: Tracing) = {
    tracing.task.map {
      _.update(_.removeTracing(tracing))
    }
    UsedTracings.removeAll(tracing)
    super.remove(tracing)
  }

  def assignReviewee(trainingsTracing: Tracing, user: User): Option[Tracing] = {
    for {
      task <- trainingsTracing.task
      sampleId <- task.training.map(_.sample)
      sample <- Tracing.findOneById(sampleId)
    } yield {
      val reviewTracing = createReviewFor(sample, trainingsTracing, user)
      insertOne(reviewTracing)
      trainingsTracing.update(_.assignReviewer(user, reviewTracing))
    }
  }

  def createTracingFor(u: User, d: DataSet = DataSet.default) = {
    val tree = DBTree.createEmptyTree
    insertOne(Tracing(u._id,
      d.name,
      List(tree._id),
      Nil,
      System.currentTimeMillis,
      1,
      Scale(12, 12, 24),
      Point3D(0, 0, 0),
      tracingType = TracingType.Explorational))
  }

  def findTrainingForReviewTracing(tracing: Tracing) = {
    findOne(MongoDBObject("review.reviewTracing" -> tracing._id))
  }

  def findOpenTracingFor(user: User, isExploratory: Boolean) =
    findOne(MongoDBObject("_user" -> user._id, "state.isFinished" -> false, "taskId" -> MongoDBObject("$exists" -> isExploratory)))

  def findOpenTrainingFor(user: User) =
    findOne(MongoDBObject("_user" -> user._id, "state.isFinished" -> false, "tracingType" -> "Training"))

  def hasOpenTracing(user: User, isExploratory: Boolean) =
    findOpenTracingFor(user, isExploratory).isDefined

  def findFor(u: User) = {
    find(MongoDBObject("_user" -> u._id)).toList
  }

  def findAllOpen(tracingType: TracingType.Value) = {
    find(MongoDBObject(
      "state.isFinished" -> false, "taskId" -> MongoDBObject("$exists" -> true))).toList
  }

  def findAllExploratory(user: User) = {
    find(MongoDBObject(
      "_user" -> user._id,
      "taskId" -> MongoDBObject("$exists" -> false))).toList
  }

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

    def writes(e: Tracing) = Json.obj(
      ID -> e.id,
      VERSION -> e.version,
      TREES -> e.trees.map(DBTreeFormat.writes),
      ACTIVE_NODE -> e.activeNodeId,
      BRANCH_POINTS -> e.branchPoints,
      SCALE -> e.scale,
      COMMENTS -> e.comments,
      EDIT_POSITION -> e.editPosition)

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
          exp.copy(trees = trees, version = version, activeNodeId = activeNode, branchPoints = branchPoints, editPosition = editPosition, comments = comments)
        case _ =>
          throw new RuntimeException("Valid tracing id expected")
      }
    }*/
  }
}
