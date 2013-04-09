package models.tracing

import brainflight.tools.geometry.Point3D
import com.mongodb.casbah.commons.MongoDBObject
import org.bson.types.ObjectId
import play.api.libs.json._
import play.api.data.validation.ValidationError
import xml.Xml
import xml.XMLWrites
import models.binary.DataSet
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
import models.security.Role
import nml._
import nml.utils._
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
    _name: Option[String] = None,
    _id: ObjectId = new ObjectId) extends TracingLike with ContainsTracingInfo with DAOCaseClass[Tracing] {

  type Self = Tracing

  def dao = Tracing

  def makeReadOnly = this.copy(tracingSettings = tracingSettings.copy(isEditable = false))

  def accessPermission(user: User) =
    this._user == user._id || (Role.Admin.map(user.hasRole) getOrElse false)

  /**
   * Easy access methods
   */

  val name = _name getOrElse ""

  override lazy val user = User.findOneById(_user)

  val date = new Date(timestamp)

  lazy val id = _id.toString

  def task = _task flatMap Task.findOneById

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

  def maxNodeId = nml.utils.maxNodeId(this.trees)

  def clearTracing = {
    this.copy(branchPoints = Nil, comments = Nil)
  }

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
    task.map(_.update(_.unassigneOnce))
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

object Tracing extends BasicDAO[Tracing]("tracings") with TracingStatistics {
  this.collection.ensureIndex("_task")
  this.collection.ensureIndex("_user")

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
    val tree = Tree(1, Set(Node(1, start)), Set.empty, Color.RED)
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
    val reviewTracing = copyDeepAndInsert(training.copy(
      _user = user._id,
      state = TracingState.Assigned,
      timestamp = System.currentTimeMillis,
      tracingType = TracingType.Review))

    mergeTracings(sample, reviewTracing)
  }

  def createSample(taskId: ObjectId, tracing: Tracing) = {
    copyDeepAndInsert(tracing.copy(
      tracingType = TracingType.Sample,
      _task = Some(taskId)))
  }

  def copyDeepAndInsert(source: Tracing) = {
    val tracing = insertOne(source.copy(_id = new ObjectId, branchPoints = Nil, comments = Nil))
    mergeTracings(source, tracing)
  }

  def mergeTracings(source: Tracing, target: Tracing): Tracing =
    target.update(_.mergeWith(source))

  def createTracingFor(user: User, task: Task) = {
    task.tracingBase.map { tracingBase =>
      task.update(_.assigneOnce)

      copyDeepAndInsert(tracingBase.copy(
        _user = user._id,
        timestamp = System.currentTimeMillis,
        state = InProgress,
        tracingType = TracingType.Task))
    }
  }

  def resetToBase(tracing: Tracing) = {
    for {
      task <- tracing.task
      tracingBase <- task.tracingBase
    } yield {
      DBTree.removeAllWithTracingId(tracing._id)
      mergeTracings(tracingBase, tracing.clearTracing)
    }
  }

  def freeTacingsOfUser(userId: ObjectId) = {
    find(MongoDBObject(
      "_user" -> userId,
      "state.isFinished" -> false,
      "tracingType" -> TracingType.Task.toString))
      .toList
      .foreach(_.update(_.cancel))

    update(
      MongoDBObject(
        "_user" -> userId,
        "tracingType" -> MongoDBObject("$in" -> TracingType.UserTracings.map(_.toString))),
      MongoDBObject(
        "$set" -> MongoDBObject(
          "state.isAssigned" -> false)))
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

  def createFromNMLFor(userId: ObjectId, nml: NML, tracingType: TracingType.Value, name: Option[String]) = {
    val tracing = insertOne(fromNML(userId, nml).copy(
      _name = name,
      tracingType = tracingType))

    nml.trees.map(tree => DBTree.insertOne(tracing._id, tree))
    tracing
  }

  def createFromNMLsFor(userId: ObjectId, nmls: List[NML], tracingType: TracingType.Value, name: Option[String]) = {
    nmls match {
      case head :: tail =>
        val startTracing = Tracing.createFromNMLFor(
          userId,
          head,
          TracingType.Explorational,
          name)

        val tracing =
          tail.foldLeft(startTracing) {
            case (t, s) => t.mergeWith(TemporaryTracing.createFrom(s, s.timeStamp.toString))
          }

        Some(tracing)
      case _ =>
        None
    }
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

  def updateAllUsingNewTaskType(task: Task, taskType: TaskType) = {
    update(
      MongoDBObject(
        "_task" -> task._id),
      MongoDBObject(
        "tracingSettings" -> taskType.tracingSettings),
      false, true)
  }

  def findTrainingForReviewTracing(tracing: Tracing) =
    findOne(MongoDBObject("review.reviewTracing" -> tracing._id))

  /*def findOpenTrainingFor(user: User) =
    findOne(MongoDBObject("_user" -> user._id, "state.isFinished" -> false, "tracingType" -> "Training"))
*/
  def countOpenTracings(user: User, tracingType: TracingType.Value) =
    findOpenTracingsFor(user, tracingType).size

  def hasAnOpenTracings(user: User, tracingType: TracingType.Value) =
    countOpenTracings(user, tracingType) > 0

  def findFor(u: User) =
    find(MongoDBObject(
      "_user" -> u._id,
      "state.isAssigned" -> true)).toList

  def findFor(u: User, tracingType: TracingType.Value) =
    find(MongoDBObject(
      "_user" -> u._id,
      "state.isAssigned" -> true,
      "tracingType" -> tracingType.toString)).toList

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
}
