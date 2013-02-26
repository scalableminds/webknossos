package braingames.levelcreator

import akka.actor._
import java.io.File
import scala.concurrent.duration._
import play.api._
import models.knowledge._
import com.amazonaws.services.s3.AmazonS3Client
import com.amazonaws.auth.BasicAWSCredentials


case class UploadStack(level: Level, mission: Mission)

class S3Uploader extends Actor{

  val conf = Play.current.configuration
  val AWS_ACCESS_KEY = conf.getString("AWS_ACCESS_KEY") getOrElse ""
  val AWS_SECRET_KEY = conf.getString("AWS_SECRET_KEY") getOrElse ""
  
  val AWS_CREDENTIALS = new BasicAWSCredentials(AWS_ACCESS_KEY, AWS_SECRET_KEY)
  val s3 = new AmazonS3Client(AWS_CREDENTIALS)
  
  def receive = {
    case UploadStack(level, mission) => uploadStack(level, mission)
  }
  
  def uploadStack(level: Level, mission: Mission) = {
    
  }
}