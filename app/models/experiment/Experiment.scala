package models.experiment

import play.api.libs.json.JsValue
import play.api.libs.json.Reads
import brainflight.tools.geometry.Point3D
import com.mongodb.casbah.commons.MongoDBObject
import org.bson.types.ObjectId
import play.api.libs.json.Writes
import play.api.libs.json.Json
import xml.Xml
import xml.XMLWrites
import models.binary.DataSet
import models.graph.Tree.TreeFormat
import models.graph._
import models.user.User
import play.api.libs.json.Reads
import play.api.libs.json.JsValue
import play.api.libs.json.Format
import brainflight.tools.geometry.Scale
import java.util.Date
import com.mongodb.casbah.query._
import models.experiment.ExperimentState._
import nml.NMLParser
import net.liftweb.json._
import net.liftweb.json.Serialization.write
import models.task._
import models.basics._

case class Experiment(
    _user: ObjectId,
    dataSetName: String,
    trees: List[Tree],
    branchPoints: List[BranchPoint],
    timestamp: Long,
    activeNodeId: Int,
    scale: Scale,
    editPosition: Point3D,
    taskId: Option[ObjectId] = None,
    state: ExperimentState = InProgress,
    review: Option[ExperimentReview] = None,
    experimentType: ExperimentType.Value = ExperimentType.Explorational,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[Experiment] {

  def dao = Experiment
  /**
   * Easy access methods
   */
  def user = User.findOneById(_user)

  val date = {
    new Date(timestamp)
  }

  lazy val id = _id.toString

  def isTrainingsExperiment = experimentType == ExperimentType.Training

  def task = taskId flatMap Task.findOneById

  def isExploratory = experimentType == ExperimentType.Explorational

  /**
   * Tree modification
   */
  def tree(treeId: Int) = trees.find(_.id == treeId)

  def updateTree(tree: Tree) = this.copy(trees = tree :: trees.filter(_.id == tree.id))

  /**
   * State modifications
   * always return a new instance!
   */
  def unassign =
    this.copy(
      state = InReview,
      review = None)

  def asReviewFor(training: Experiment, user: User) = {
    this.copy(
      _id = new ObjectId,
      _user = user._id,
      trees =
        NMLParser.createUniqueIds(training.trees ::: this.trees),
      timestamp = System.currentTimeMillis,
      experimentType = ExperimentType.Review)
  }

  def finishReview(comment: String) = {
    val alteredReview = this.review.map(_.copy(comment = Some(comment)))
    this.copy(review = alteredReview)
  }
  
    def finish = {
    this.copy(state = Finished)
  }

  def passToReview = {
    this.copy(state = InReview, review = None)
  }

  def reopen = {
    this.copy(state = Reopened)
  }

  def removeTask= {
    this.copy(taskId = None)
  }
}

object Experiment extends BasicDAO[Experiment]("experiments") {

  implicit object ExperimentXMLWrites extends XMLWrites[Experiment] {
    def writes(e: Experiment) = {
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
          { e.trees.map(e => Xml.toXML(e)) }
          <comments>
            {
              for {
                tree <- e.trees
                node <- tree.nodes
                comment <- node.comment
              } yield {
                <comment node={ node.id.toString } content={ comment }/>
              }
            }
          </comments>
          <branchpoints>
            { e.branchPoints.map(BranchPoint.toXML) }
          </branchpoints>
        </things>
      }) getOrElse (<error>DataSet not fount</error>)
    }
  }

  def createExperimentFor(user: User, task: Task) = {
    alterAndInsert(Experiment(user._id,
      task.dataSetName,
      List(Tree.empty),
      Nil,
      System.currentTimeMillis,
      1,
      Scale(12, 12, 24),
      task.start,
      Some(task._id),
      experimentType =
        if (task.isTraining) ExperimentType.Training
        else ExperimentType.Task))
  }

  override def remove(experiment: Experiment) = {
    experiment.task.map {
      Task.removeExperiment(_, experiment)
    }
    UsedExperiments.removeAll(experiment)
    super.remove(experiment)
  }

  def assignReviewee(trainingsExperiment: Experiment, user: User): Option[Experiment] = {
    for {
      task <- trainingsExperiment.task
      sampleId <- task.training.map(_.sample)
      sample <- Experiment.findOneById(sampleId)
    } yield {
      val reviewExperiment = sample.asReviewFor(trainingsExperiment, user)
      Experiment.insert(reviewExperiment)
      trainingsExperiment.update {
        _.copy(
          state = InReview,
          review = Some(ExperimentReview(
            user._id,
            reviewExperiment._id,
            System.currentTimeMillis())))
      }
    }
  }

  def createExperimentFor(u: User, d: DataSet = DataSet.default) = {
    alterAndInsert(Experiment(u._id,
      d.name,
      List(Tree.empty),
      Nil,
      System.currentTimeMillis,
      1,
      Scale(12, 12, 24),
      Point3D(0, 0, 0),
      experimentType = ExperimentType.Explorational))
  }

  def findOpenExperimentFor(user: User, isExploratory: Boolean) =
    findOne(MongoDBObject("_user" -> user._id, "state.isFinished" -> false, "taskId" -> MongoDBObject("$exists" -> isExploratory)))

  def hasOpenExperiment(user: User, isExploratory: Boolean) =
    findOpenExperimentFor(user, isExploratory).isDefined

  def findFor(u: User) = {
    find(MongoDBObject("_user" -> u._id)).toList
  }

  def findAllExploratory(user: User) = {
    find(MongoDBObject(
      "_user" -> user._id,
      "taskId" -> MongoDBObject("$exists" -> false))).toList
  }

  implicit object ExperimentFormat extends Format[Experiment] {
    val ID = "id"
    val TREES = "trees"
    val ACTIVE_NODE = "activeNode"
    val BRANCH_POINTS = "branchPoints"
    val EDIT_POSITION = "editPosition"
    val SCALE = "scale"

    def writes(e: Experiment) = Json.obj(
      ID -> e.id,
      TREES -> e.trees.map(TreeFormat.writes),
      ACTIVE_NODE -> e.activeNodeId,
      BRANCH_POINTS -> e.branchPoints,
      SCALE -> e.scale,
      EDIT_POSITION -> e.editPosition)

    def reads(js: JsValue): Experiment = {

      val id = (js \ ID).as[String]
      val trees = (js \ TREES).as[List[Tree]]
      val activeNode = (js \ ACTIVE_NODE).as[Int]
      val branchPoints = (js \ BRANCH_POINTS).as[List[BranchPoint]]
      val editPosition = (js \ EDIT_POSITION).as[Point3D]
      Experiment.findOneById(id) match {
        case Some(exp) =>
          exp.copy(trees = trees, activeNodeId = activeNode, branchPoints = branchPoints, editPosition = editPosition)
        case _ =>
          throw new RuntimeException("Valid experiment id expected")
      }
    }
  }
}