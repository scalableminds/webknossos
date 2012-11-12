package models.experiment

import org.bson.types.ObjectId
import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import models.basics.BasicDAO
import models.user.User
import java.util.Date

case class ExperimentReview(
    _reviewee: ObjectId,
    reviewExperiment: ObjectId,
    timestamp: Long,
    comment: Option[String] = None,
    _id: ObjectId = new ObjectId) {

  def reviewee = User.findOneById(_reviewee)
  
  val date = new Date(timestamp)
}