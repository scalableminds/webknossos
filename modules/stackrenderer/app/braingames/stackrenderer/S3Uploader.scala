package braingames.stackrenderer

import akka.actor._
import java.io.File
import scala.concurrent.duration._
import play.api._
import models.knowledge._
import com.amazonaws.services.s3.model._
import com.amazonaws.auth.BasicAWSCredentials
import com.amazonaws.services.s3.AmazonS3Client
import braingames.util.ZipIO
import scala.util.Try
import scala.util.Success
import scala.util.Failure

case class UploadStack(stacks: Stack)

class S3Uploader(s3Config: S3Config) extends Actor {

  lazy val AWSCredentials = new BasicAWSCredentials(s3Config.accessKey, s3Config.secretKey)
  lazy val s3 = new AmazonS3Client(AWSCredentials)
  Logger.info("starting S3 uploader")

  def receive = {
    case UploadStack(stack) =>
      uploadStack(stack) match{
        case Success(downloadUrls) =>
        sender ! FinishedUpload(stack, downloadUrls)
        case Failure(f) =>
          Logger.error("An error occoured during upload: " + f)
          sender ! FailedUpload(stack)
      }
  }

  val gzipMetadata = {
    val metadata = new ObjectMetadata()
    metadata.setContentEncoding("gzip")
    metadata
  }

  def uploadStack(stack: Stack): Try[List[String]] = {
    Try{
      if (s3Config.isEnabled){
        for {
          (file, key) <- buildUploadPairs(stack)
        } yield {
          val gzipped = ZipIO.gzipToTempFile(file)
          Logger.debug(s"uploading ${file.getPath} to ${s3Config.bucketName}/$key")
          val putObj = new PutObjectRequest(s3Config.bucketName, key, gzipped)
          putObj.setCannedAcl(CannedAccessControlList.PublicRead);
          putObj.setMetadata(gzipMetadata)
          val r = s3.putObject(putObj)
          s3.getResourceUrl(s3Config.bucketName, key)
        }
      } else
        Nil
    }
  }

  def buildUploadPairs(stack: Stack): List[Tuple2[File, String]] = {
    val filesToUpload = stack.tarFile :: stack.metaFile :: Nil

    val stackFilePrefix = s"${s3Config.branchName}/${stack.level.levelId}/${stack.mission.id}"

    filesToUpload.zip(filesToUpload.map(f =>
      s"$stackFilePrefix/${f.getName}"))

  }
}

object S3Uploader {
  def start(implicit conf: Configuration, system: ActorSystem) = {
    val s3Config = S3Config.fromConfig(conf) getOrElse {
      Logger.error("S3Uploader couldn't be started, because some S3 settings are missing.")
      S3Config.defaultDisabled
    }
    system.actorOf(Props(new S3Uploader(s3Config)), name = "stackUploader")
  }
}