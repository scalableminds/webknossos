package braingames.levelcreator

import akka.actor._
import java.io.File
import scala.concurrent.duration._
import play.api._
import models.knowledge._
import com.amazonaws.services.s3.AmazonS3Client
import com.amazonaws.auth.BasicAWSCredentials
import braingames.util.S3Config


case class UploadStacks(stacks: List[Stack])

class S3Uploader(s3Config: S3Config) extends Actor{

  val AWSCredentials = new BasicAWSCredentials(s3Config.accessKey, s3Config.secretKey)
  val s3 = new AmazonS3Client(AWSCredentials)
   
  def receive = {
    case UploadStacks(stacks) => uploadStacks(stacks)
  }
  
  def uploadStacks(stacks: List[Stack]) = {
    
  }
  
}