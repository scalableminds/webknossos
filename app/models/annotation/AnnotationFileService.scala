/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import java.io._
import java.nio.channels.Channels

import scala.concurrent.Future

import com.scalableminds.util.io.{NamedEnumeratorStream, NamedFileStream, NamedFunctionStream, NamedStream}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.tracing.skeleton.SkeletonTracingLike
import org.apache.commons.io.IOUtils
import models.annotation.handler.SavedTracingInformationHandler
import oxalis.nml.NMLService
import play.api.Play
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import resource._

trait AnnotationFileService extends FoxImplicits with LazyLogging{

  def annotation: Annotation

  val conf = Play.current.configuration

  val defaultDownloadExtension = ".txt"

  def fileExtension(annotation: Annotation) =
    annotation.content.map(_.downloadFileExtension) getOrElse defaultDownloadExtension

  val annotationStorageFolder = {
    val folder = conf.getString("oxalis.annotation.storageFolder") getOrElse "data/nmls"
    new File(folder).mkdirs()
    folder
  }

  def outputPathForAnnotation() = fileExtension(annotation).map{ ext =>
    s"$annotationStorageFolder/${annotation.id}$ext"
  }

  def writeAnnotationToFile(): Fox[Boolean] = {
    for {
      path <- outputPathForAnnotation()
      out <- managed(new FileOutputStream(new File(path))).toFuture
      _ <- annotationIntoOutputStream(out)
    } yield true
  }

  def loadAnnotationContentFromFileStream(): Fox[File] = {
    if (annotation.state.isFinished) {
      outputPathForAnnotation().map{ path =>
        val f = new File(path)
        if (f.exists())
          Some(f)
        else
          None
      }
    } else
      None
  }

  def loadNamedAnnotationContentStream(name: String): Future[NamedStream] = {
    loadAnnotationContentFromFileStream().orElse {
      writeAnnotationToFile().flatMap{ x =>
        loadAnnotationContentFromFileStream()
      }
    }.map{ file =>
      NamedFileStream(file, name + ".nml")
    }.getOrElse {
      NamedFunctionStream(name + ".nml", os => annotationIntoOutputStream(os).futureBox.map(_ => Unit))
    }
  }

  def loadAnnotationContent()(implicit ctx: DBAccessContext): Fox[NamedStream] = {
    for{
      name <- SavedTracingInformationHandler.nameForAnnotation(annotation)
      annotationStream <- loadNamedAnnotationContentStream(name)
    } yield annotationStream
  }

  def annotationIntoOutputStream(os: OutputStream): Fox[Boolean] = {
    annotation.content.flatMap {
      case t: SkeletonTracingLike =>
        NMLService.toNML(t, os)
      case _ =>
        throw new Exception("Invalid content!")
    }
  }
}
