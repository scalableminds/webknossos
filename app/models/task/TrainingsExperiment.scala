package models.task

import org.bson.types.ObjectId
import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import models.user.User

abstract class ExperimentState
case class Open() extends ExperimentState

case class TrainingsExperiment(
  experiment: Experiment,
  reviewee: Option[ObjectId] = None,
  comment: Option[String] = None,
  state: ExperimentState = Open(),
  _id: ObjectId = new ObjectId)

object TrainingsExperiment extends BasicDAO[TrainingsExperiment]("trainingsExperiments") {
  def assignReviewee(te: TrainingsExperiment, user: User) = {
    alterAndSave(te.copy(reviewee = Some(user._id)))
  }
}