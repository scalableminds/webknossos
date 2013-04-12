package braingames.stackrenderer

import akka.actor._
import java.io.File
import scala.concurrent.duration._
import play.api._
import models.knowledge._
import com.amazonaws.services.s3.model._
import com.amazonaws.auth.BasicAWSCredentials
import com.amazonaws.services.s3.AmazonS3Client

case class UploadStack(id: String, stacks: Stack)

class S3Uploader(s3Config: S3Config) extends Actor {

  val AWSCredentials = new BasicAWSCredentials(s3Config.accessKey, s3Config.secretKey)
  val s3 = new AmazonS3Client(AWSCredentials)
  Logger.info("starting S3 uploader")

  def receive = {
    case UploadStack(id, stack) => 
      uploadStack(stack)
      sender ! FinishedUpload(id, stack)
  }
  
    def uploadStack(stack: Stack) = {
    for {
      uploadPair <- buildUploadPairs(stack)
    } {
      val (file, key) = uploadPair
      Logger.debug(s"uploading ${file.getPath} to ${s3Config.bucketName}/$key")
      val putObj = new PutObjectRequest(s3Config.bucketName, key, file)
      putObj.setCannedAcl(CannedAccessControlList.PublicRead);
      s3.putObject(putObj);
    }
  }

  def buildUploadPairs(stack: Stack): List[Tuple2[File, String]] = {
    val stacksFileKey = s"${s3Config.branchName}/${stack.level.id}/${stack.level.stacksFileName}"
    val stackFiles = stack.metaFile :: stack.images
    val stackFilePrefix = s"${s3Config.branchName}/${stack.level.id}/${stack.mission.id}"
    val zipFileKey = s"$stackFilePrefix/${stack.zipFile.getName}"
    (stackFiles.zip(stackFiles.map(f => s"$stackFilePrefix/${f.getName}"))) :+
      (stack.level.stacksFile, stacksFileKey) :+
      (stack.zipFile, zipFileKey)

  }



}