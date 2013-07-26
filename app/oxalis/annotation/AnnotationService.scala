package oxalis.annotation

import models.annotation.Annotation
import java.io.{InputStream, FileInputStream, FileOutputStream, File}
import java.nio.channels.Channels
import models.tracing.skeleton.SkeletonTracingLike
import org.apache.commons.io.IOUtils
import play.api.Play
import oxalis.nml.NMLService
import scala.concurrent.Future
import braingames.util.NamedFileStream
import oxalis.annotation.handler.SavedTracingInformationHandler
import play.api.libs.concurrent.Execution.Implicits._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 26.07.13
 * Time: 12:08
 */
object AnnotationService extends AnnotationFileService{

}

trait AnnotationFileService{

  val conf = Play.current.configuration

  val annotationStorageFolder = {
    val folder = conf.getString("oxalis.nml.storageFolder") getOrElse "data/nmls"
    new File(folder).mkdirs()
    folder
  }

  def outputPathForAnnotation(annotation: Annotation) =
    s"$annotationStorageFolder/${annotation.id}.${annotation.content.map{_.downloadFileExtension}}"

  def writeAnnotationToFile(annotation: Annotation) {
    for {
      futureStream <- annotationToInputStream(annotation)
      in <- futureStream
    } {
      val f = new File(outputPathForAnnotation(annotation))
      val out = new FileOutputStream(f).getChannel
      val ch = Channels.newChannel(in)
      try {
        out.transferFrom(ch, 0, in.available)
      } finally {
        ch.close()
        out.close()
      }
    }
  }

  def loadAnnotationContentFromFileStream(annotation: Annotation) = {
    if (annotation.state.isFinished) {
      val f = new File(outputPathForAnnotation(annotation))
      if (f.exists())
        Some(Future.successful(new FileInputStream(f)))
      else
        None
    } else
      None
  }

  def loadAnnotationContentStream(annotation: Annotation): Option[Future[InputStream]] = {
    loadAnnotationContentFromFileStream(annotation).orElse {
      writeAnnotationToFile(annotation)
      loadAnnotationContentFromFileStream(annotation)
    }.orElse(annotationToInputStream(annotation))
  }

  def loadAnnotationContent(annotation: Annotation) =
    loadAnnotationContentStream(annotation).map(_.map {
      annotationStream =>
        NamedFileStream(
          annotationStream,
          SavedTracingInformationHandler.nameForAnnotation(annotation) + ".nml")
    })

  def annotationToInputStream(annotation: Annotation) = {
    annotation.content.map {
      case t: SkeletonTracingLike =>
        NMLService.toNML(t).map(IOUtils.toInputStream)
      case _ =>
        throw new Exception("Invalid content!")
    }
  }
}
