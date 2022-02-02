package models.annotation.nml

import com.scalableminds.util.geometry.Scale
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.xml.Xml
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.geometry._
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import javax.inject.Inject
import javax.xml.stream.{XMLOutputFactory, XMLStreamWriter}
import models.annotation.{Annotation, AnnotationLayerType, FetchedAnnotationLayer}
import models.task.Task
import models.user.User
import org.joda.time.DateTime
import play.api.libs.iteratee.Enumerator

import scala.concurrent.ExecutionContext

case class NmlParameters(
    dataSetName: String,
    organizationName: String,
    description: Option[String],
    scale: Option[Scale],
    createdTimestamp: Long,
    editPosition: Point3D,
    editRotation: Vector3D,
    zoomLevel: Double,
    activeNodeId: Option[Int],
    userBoundingBoxes: Seq[NamedBoundingBox],
    taskBoundingBox: Option[BoundingBox]
)

class NmlWriter @Inject()(implicit ec: ExecutionContext) extends FoxImplicits {
  private lazy val outputService = XMLOutputFactory.newInstance()

  def toNmlStream(annotationLayers: List[FetchedAnnotationLayer],
                  annotation: Option[Annotation],
                  scale: Option[Scale],
                  volumeFilename: Option[String],
                  organizationName: String,
                  annotationOwner: Option[User],
                  annotationTask: Option[Task]): Enumerator[Array[Byte]] = Enumerator.outputStream { os =>
    implicit val writer: IndentingXMLStreamWriter =
      new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(os))

    for {
      nml <- toNml(annotationLayers,
                   annotation,
                   scale,
                   volumeFilename,
                   organizationName,
                   annotationOwner,
                   annotationTask)
      _ = os.close()
    } yield nml
  }

  def toNml(annotationLayers: List[FetchedAnnotationLayer],
            annotation: Option[Annotation],
            scale: Option[Scale],
            volumeFilename: Option[String],
            organizationName: String,
            annotationOwner: Option[User],
            annotationTask: Option[Task])(implicit writer: XMLStreamWriter): Fox[Unit] =
    for {
      _ <- Xml.withinElement("things") {
        for {
          _ <- Fox.successful(writeMetaData(annotation, annotationOwner, annotationTask))
          skeletonLayers = annotationLayers.filter(_.typ == AnnotationLayerType.Skeleton)
          volumeLayers = annotationLayers.filter(_.typ == AnnotationLayerType.Volume)
          _ <- bool2Fox(skeletonLayers.length <= 1) ?~> "annotation.download.multipleSkeletons"
          _ <- bool2Fox(volumeFilename.isEmpty || volumeLayers.length <= 1) ?~> "annotation.download.volumeNameForMultiple"
          parameters <- extractTracingParameters(skeletonLayers,
                                                 volumeLayers,
                                                 annotation: Option[Annotation],
                                                 organizationName,
                                                 scale)
          _ = writeParameters(parameters)
          _ = annotationLayers.filter(_.typ == AnnotationLayerType.Skeleton).map(_.tracing).foreach {
            case Left(skeletonTracing) => writeSkeletonThings(skeletonTracing)
            case _                     => ()
          }
          _ = volumeLayers.zipWithIndex.foreach {
            case (volumeLayer, index) => writeVolumeThings(volumeLayer, index, volumeLayers.length == 1, volumeFilename)
          }
        } yield ()
      }
      _ = writer.writeEndDocument()
      _ = writer.close()
    } yield ()

  def extractTracingParameters(skeletonLayers: List[FetchedAnnotationLayer],
                               volumeLayers: List[FetchedAnnotationLayer],
                               annotation: Option[Annotation],
                               organizationName: String,
                               scale: Option[Scale]): Fox[NmlParameters] =
    for {
      parameterSourceAnnotationLayer <- selectLayerWithPrecedence(skeletonLayers, volumeLayers)
      nmlParameters = parameterSourceAnnotationLayer.tracing match {
        case Left(s) =>
          NmlParameters(
            s.dataSetName,
            organizationName,
            annotation.map(_.description),
            scale,
            s.createdTimestamp,
            s.editPosition,
            s.editRotation,
            s.zoomLevel,
            s.activeNodeId,
            s.userBoundingBoxes ++ s.userBoundingBox.map(NamedBoundingBox(0, None, None, None, _)),
            s.boundingBox
          )
        case Right(v) =>
          NmlParameters(
            v.dataSetName,
            organizationName,
            annotation.map(_.description),
            scale,
            v.createdTimestamp,
            v.editPosition,
            v.editRotation,
            v.zoomLevel,
            None,
            v.userBoundingBoxes ++ v.userBoundingBox.map(NamedBoundingBox(0, None, None, None, _)),
            if (annotation.exists(_._task.isDefined)) Some(v.boundingBox) else None
          )
      }
    } yield nmlParameters

  // If there is more than one tracing, select the one that has precedence for the parameters (they should be identical anyway)
  private def selectLayerWithPrecedence(skeletonLayers: List[FetchedAnnotationLayer],
                                        volumeLayers: List[FetchedAnnotationLayer]): Fox[FetchedAnnotationLayer] =
    if (skeletonLayers.nonEmpty) {
      Fox.successful(skeletonLayers.minBy(_.tracingId))
    } else if (volumeLayers.nonEmpty) {
      Fox.successful(volumeLayers.minBy(_.tracingId))
    } else Fox.failure("annotation.download.noLayers")

  def writeParameters(parameters: NmlParameters)(implicit writer: XMLStreamWriter): Unit =
    Xml.withinElementSync("parameters") {
      Xml.withinElementSync("experiment") {
        writer.writeAttribute("name", parameters.dataSetName)
        writer.writeAttribute("organization", parameters.organizationName)
        parameters.description.foreach(writer.writeAttribute("description", _))
      }
      Xml.withinElementSync("scale") {
        writer.writeAttribute("x", parameters.scale.map(_.x).getOrElse(-1).toString)
        writer.writeAttribute("y", parameters.scale.map(_.y).getOrElse(-1).toString)
        writer.writeAttribute("z", parameters.scale.map(_.z).getOrElse(-1).toString)
      }
      Xml.withinElementSync("offset") {
        writer.writeAttribute("x", "0")
        writer.writeAttribute("y", "0")
        writer.writeAttribute("z", "0")
      }
      Xml.withinElementSync("time") {
        writer.writeAttribute("ms", parameters.createdTimestamp.toString)
      }
      Xml.withinElementSync("editPosition") {
        writer.writeAttribute("x", parameters.editPosition.x.toString)
        writer.writeAttribute("y", parameters.editPosition.y.toString)
        writer.writeAttribute("z", parameters.editPosition.z.toString)
      }
      Xml.withinElementSync("editRotation") {
        writer.writeAttribute("xRot", parameters.editRotation.x.toString)
        writer.writeAttribute("yRot", parameters.editRotation.y.toString)
        writer.writeAttribute("zRot", parameters.editRotation.z.toString)
      }
      Xml.withinElementSync("zoomLevel") {
        writer.writeAttribute("zoom", parameters.zoomLevel.toString)
      }
      parameters.activeNodeId.foreach { nodeId =>
        Xml.withinElementSync("activeNode") {
          writer.writeAttribute("id", nodeId.toString)
        }
      }
      parameters.userBoundingBoxes.foreach { b =>
        Xml.withinElementSync("userBoundingBox") {
          writer.writeAttribute("id", b.id.toString)
          b.name.foreach(writer.writeAttribute("name", _))
          b.isVisible.foreach(isVisible => writer.writeAttribute("isVisible", isVisible.toString))
          writeColor(b.color)
          writeBoundingBox(b.boundingBox)
        }
      }
      parameters.taskBoundingBox.foreach { b =>
        Xml.withinElementSync("taskBoundingBox")(writeBoundingBox(b))
      }
    }

  // Write volume things from FetchedAnnotationLayer. Caller must ensure that it is a volume annotation layer
  def writeVolumeThings(volumeLayer: FetchedAnnotationLayer,
                        index: Int,
                        isSingle: Boolean,
                        volumeFilename: Option[String])(implicit writer: XMLStreamWriter): Unit =
    Xml.withinElementSync("volume") {
      writer.writeAttribute("id", index.toString)
      writer.writeAttribute("location", volumeFilename.getOrElse(volumeLayer.volumeDataZipName(index, isSingle)))
      volumeLayer.name.foreach(_ => writer.writeAttribute("name", _))
      volumeLayer.tracing match {
        case Right(volumeTracing) => volumeTracing.fallbackLayer.foreach(writer.writeAttribute("fallbackLayer", _))
        case _                    => ()
      }
    }

  def writeSkeletonThings(skeletonTracing: SkeletonTracing)(implicit writer: XMLStreamWriter): Unit = {
    writeTreesAsXml(skeletonTracing.trees)
    Xml.withinElementSync("branchpoints")(
      writeBranchPointsAsXml(skeletonTracing.trees.flatMap(_.branchPoints).sortBy(-_.createdTimestamp)))
    Xml.withinElementSync("comments")(writeCommentsAsXml(skeletonTracing.trees.flatMap(_.comments)))
    Xml.withinElementSync("groups")(writeTreeGroupsAsXml(skeletonTracing.treeGroups))
  }

  def writeTreesAsXml(trees: Seq[Tree])(implicit writer: XMLStreamWriter): Unit =
    trees.foreach { t =>
      Xml.withinElementSync("thing") {
        writer.writeAttribute("id", t.treeId.toString)
        writeColor(t.color)
        writer.writeAttribute("name", t.name)
        t.groupId.foreach(groupId => writer.writeAttribute("groupId", groupId.toString))
        Xml.withinElementSync("nodes")(writeNodesAsXml(t.nodes.sortBy(_.id)))
        Xml.withinElementSync("edges")(writeEdgesAsXml(t.edges))
      }
    }

  def writeNodesAsXml(nodes: Seq[Node])(implicit writer: XMLStreamWriter): Unit =
    nodes.toSet.foreach { n: Node => // toSet as workaround for some erroneously duplicate nodes in the db, this was not checked on upload until 2017
      Xml.withinElementSync("node") {
        writer.writeAttribute("id", n.id.toString)
        writer.writeAttribute("radius", n.radius.toString)
        writer.writeAttribute("x", n.position.x.toString)
        writer.writeAttribute("y", n.position.y.toString)
        writer.writeAttribute("z", n.position.z.toString)
        writer.writeAttribute("rotX", n.rotation.x.toString)
        writer.writeAttribute("rotY", n.rotation.y.toString)
        writer.writeAttribute("rotZ", n.rotation.z.toString)
        writer.writeAttribute("inVp", n.viewport.toString)
        writer.writeAttribute("inMag", n.resolution.toString)
        writer.writeAttribute("bitDepth", n.bitDepth.toString)
        writer.writeAttribute("interpolation", n.interpolation.toString)
        writer.writeAttribute("time", n.createdTimestamp.toString)
      }
    }

  def writeEdgesAsXml(edges: Seq[Edge])(implicit writer: XMLStreamWriter): Unit =
    edges.foreach { e =>
      Xml.withinElementSync("edge") {
        writer.writeAttribute("source", e.source.toString)
        writer.writeAttribute("target", e.target.toString)
      }
    }

  def writeBranchPointsAsXml(branchPoints: Seq[BranchPoint])(implicit writer: XMLStreamWriter): Unit =
    branchPoints.foreach { b =>
      Xml.withinElementSync("branchpoint") {
        writer.writeAttribute("id", b.nodeId.toString)
        writer.writeAttribute("time", b.createdTimestamp.toString)
      }
    }

  def writeCommentsAsXml(comments: Seq[Comment])(implicit writer: XMLStreamWriter): Unit =
    comments.foreach { c =>
      Xml.withinElementSync("comment") {
        writer.writeAttribute("node", c.nodeId.toString)
        writer.writeAttribute("content", c.content)
      }
    }

  def writeTreeGroupsAsXml(treeGroups: Seq[TreeGroup])(implicit writer: XMLStreamWriter): Unit =
    treeGroups.foreach { t =>
      Xml.withinElementSync("group") {
        writer.writeAttribute("name", t.name)
        writer.writeAttribute("id", t.groupId.toString)
        writeTreeGroupsAsXml(t.children)
      }
    }

  def writeMetaData(annotationOpt: Option[Annotation], userOpt: Option[User], taskOpt: Option[Task])(
      implicit writer: XMLStreamWriter): Unit = {
    Xml.withinElementSync("meta") {
      writer.writeAttribute("name", "writer")
      writer.writeAttribute("content", "NmlWriter.scala")
    }
    Xml.withinElementSync("meta") {
      writer.writeAttribute("name", "writerGitCommit")
      writer.writeAttribute("content", webknossos.BuildInfo.commitHash)
    }
    Xml.withinElementSync("meta") {
      writer.writeAttribute("name", "timestamp")
      writer.writeAttribute("content", DateTime.now().getMillis.toString)
    }
    annotationOpt.foreach { annotation =>
      Xml.withinElementSync("meta") {
        writer.writeAttribute("name", "annotationId")
        writer.writeAttribute("content", annotation.id)
      }
    }
    userOpt.foreach { user =>
      Xml.withinElementSync("meta") {
        writer.writeAttribute("name", "username")
        writer.writeAttribute("content", user.name)
      }
    }
    taskOpt.foreach { task =>
      Xml.withinElementSync("meta") {
        writer.writeAttribute("name", "taskId")
        writer.writeAttribute("content", task._id.toString)
      }
    }
  }

  def writeBoundingBox(b: BoundingBox)(implicit writer: XMLStreamWriter): Unit = {
    writer.writeAttribute("topLeftX", b.topLeft.x.toString)
    writer.writeAttribute("topLeftY", b.topLeft.y.toString)
    writer.writeAttribute("topLeftZ", b.topLeft.z.toString)
    writer.writeAttribute("width", b.width.toString)
    writer.writeAttribute("height", b.height.toString)
    writer.writeAttribute("depth", b.depth.toString)
  }

  def writeColor(color: Option[Color])(implicit writer: XMLStreamWriter): Unit = {
    writer.writeAttribute("color.r", color.map(_.r.toString).getOrElse(""))
    writer.writeAttribute("color.g", color.map(_.g.toString).getOrElse(""))
    writer.writeAttribute("color.b", color.map(_.b.toString).getOrElse(""))
    writer.writeAttribute("color.a", color.map(_.a.toString).getOrElse(""))
  }
}
