package models.task

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import models.user.User

case class TrainingsTask(
    task: Task,
    experience: String,
    gainExperience: Int,
    loseExperience: Int,
    _id: ObjectId = new ObjectId) {

  lazy val id = _id.toString

  def taskType = task.taskType
}

object TrainingsTask extends BasicDAO[TrainingsTask]("trainingsTasks") {

  def toForm(tt: TrainingsTask) = {
    Some(tt.task.id,tt.experience, tt.gainExperience, tt.loseExperience)
  }

  def fromForm(taskId: String, experience: String, gain: Int, lose: Int) = {
    Task.findOneById(taskId).map { task =>
      TrainingsTask(task, experience, gain, lose)
    } getOrElse null
  }
  
  def createExperimentFor(user: User, trainingsTask: TrainingsTask) = {
    val exp = Task.createExperimentFor(user, trainingsTask.task)
    TrainingsExperiment.alterAndInsert(TrainingsExperiment(exp))
  }

  def addExperiment(trainingsTask: TrainingsTask, experiment: TrainingsExperiment) =
    alterAndSave(trainingsTask.copy(task = trainingsTask.task.copy(
      _experiments = experiment._id :: trainingsTask.task._experiments)))

}