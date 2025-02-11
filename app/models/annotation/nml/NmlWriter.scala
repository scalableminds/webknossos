package models.annotation.nml

import com.scalableminds.util.io.NamedFunctionStream
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.xml.Xml
import com.scalableminds.webknossos.datastore.SkeletonTracing._
import com.scalableminds.webknossos.datastore.MetadataEntry.MetadataEntryProto
import com.scalableminds.webknossos.datastore.VolumeTracing.{Segment, SegmentGroup}
import com.scalableminds.webknossos.datastore.geometry._
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.annotation.{AnnotationLayerType, FetchedAnnotationLayer}
import com.scalableminds.webknossos.tracingstore.tracings.volume.VolumeDataZipFormat.VolumeDataZipFormat
import com.sun.xml.txw2.output.IndentingXMLStreamWriter
import models.annotation.{Annotation, AnnotationLayerPrecedence}
import models.task.Task
import models.user.User

import javax.inject.Inject
import javax.xml.stream.{XMLOutputFactory, XMLStreamWriter}
import scala.concurrent.ExecutionContext

case class NmlParameters(
    datasetId: ObjectId,
    datasetName: String,
    organizationId: String,
    description: Option[String],
    wkUrl: String,
    voxelSize: Option[VoxelSize],
    createdTimestamp: Long,
    editPosition: Vec3IntProto,
    editRotation: Vec3DoubleProto,
    zoomLevel: Double,
    activeNodeId: Option[Int],
    userBoundingBoxes: Seq[NamedBoundingBoxProto],
    taskBoundingBox: Option[BoundingBoxProto],
    additionalAxisProtos: Seq[AdditionalAxisProto],
    editPositionAdditionalCoordinates: Seq[AdditionalCoordinateProto]
)

class NmlWriter @Inject()(implicit ec: ExecutionContext) extends FoxImplicits with AnnotationLayerPrecedence {
  private lazy val outputService = XMLOutputFactory.newInstance()

  def toNmlStream(name: String,
                  annotationLayers: List[FetchedAnnotationLayer],
                  annotation: Option[Annotation],
                  scale: Option[VoxelSize],
                  volumeFilename: Option[String],
                  organizationId: String,
                  wkUrl: String,
                  datasetName: String,
                  datasetId: ObjectId,
                  annotationOwner: Option[User],
                  annotationTask: Option[Task],
                  skipVolumeData: Boolean = false,
                  volumeDataZipFormat: VolumeDataZipFormat): NamedFunctionStream =
    NamedFunctionStream(
      name,
      os => {
        implicit val writer: IndentingXMLStreamWriter =
          new IndentingXMLStreamWriter(outputService.createXMLStreamWriter(os))

        for {
          nml <- toNmlWithImplicitWriter(
            annotationLayers,
            annotation,
            scale,
            volumeFilename,
            organizationId,
            wkUrl,
            datasetName,
            datasetId,
            annotationOwner,
            annotationTask,
            skipVolumeData,
            volumeDataZipFormat
          )
        } yield nml
      }
    )

  private def toNmlWithImplicitWriter(
      annotationLayers: List[FetchedAnnotationLayer],
      annotation: Option[Annotation],
      voxelSize: Option[VoxelSize],
      volumeFilename: Option[String],
      organizationId: String,
      wkUrl: String,
      datasetName: String,
      datasetId: ObjectId,
      annotationOwner: Option[User],
      annotationTask: Option[Task],
      skipVolumeData: Boolean,
      volumeDataZipFormat: VolumeDataZipFormat)(implicit writer: XMLStreamWriter): Fox[Unit] =
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
                                                 organizationId,
                                                 wkUrl,
                                                 datasetName,
                                                 datasetId,
                                                 voxelSize)
          _ = writeParameters(parameters)
          _ = annotationLayers.filter(_.typ == AnnotationLayerType.Skeleton).map(_.tracing).foreach {
            case Left(skeletonTracing) => writeSkeletonThings(skeletonTracing)
            case _                     => ()
          }
          _ = volumeLayers.zipWithIndex.foreach {
            case (volumeLayer, index) =>
              writeVolumeThings(volumeLayer,
                                index,
                                volumeLayers.length == 1,
                                volumeFilename,
                                skipVolumeData,
                                volumeDataZipFormat)
          }
        } yield ()
      }
      _ = writer.writeEndDocument()
      _ = writer.close()
    } yield ()

  private def extractTracingParameters(skeletonLayers: List[FetchedAnnotationLayer],
                                       volumeLayers: List[FetchedAnnotationLayer],
                                       annotation: Option[Annotation],
                                       organizationId: String,
                                       wkUrl: String,
                                       datasetName: String,
                                       datasetId: ObjectId,
                                       voxelSize: Option[VoxelSize]): Fox[NmlParameters] =
    for {
      parameterSourceAnnotationLayer <- selectLayerWithPrecedenceFetched(skeletonLayers, volumeLayers)
      nmlParameters = parameterSourceAnnotationLayer.tracing match {
        case Left(s) =>
          NmlParameters(
            datasetId,
            datasetName,
            organizationId,
            annotation.map(_.description),
            wkUrl,
            voxelSize,
            s.createdTimestamp,
            s.editPosition,
            s.editRotation,
            s.zoomLevel,
            s.activeNodeId,
            s.userBoundingBoxes ++ s.userBoundingBox.map(NamedBoundingBoxProto(0, None, None, None, _)),
            s.boundingBox,
            s.additionalAxes,
            s.editPositionAdditionalCoordinates
          )
        case Right(v) =>
          NmlParameters(
            datasetId,
            datasetName,
            organizationId,
            annotation.map(_.description),
            wkUrl,
            voxelSize,
            v.createdTimestamp,
            v.editPosition,
            v.editRotation,
            v.zoomLevel,
            None,
            v.userBoundingBoxes ++ v.userBoundingBox.map(NamedBoundingBoxProto(0, None, None, None, _)),
            if (annotation.exists(_._task.isDefined)) Some(v.boundingBox) else None,
            v.additionalAxes,
            v.editPositionAdditionalCoordinates
          )
      }
    } yield nmlParameters

  private def writeParameters(parameters: NmlParameters)(implicit writer: XMLStreamWriter): Unit =
    Xml.withinElementSync("parameters") {
      Xml.withinElementSync("experiment") {
        writer.writeAttribute("name", parameters.datasetName)
        writer.writeAttribute("organization", parameters.organizationId)
        writer.writeAttribute("datasetId", parameters.datasetId.toString)
        parameters.description.foreach(writer.writeAttribute("description", _))
        writer.writeAttribute("wkUrl", parameters.wkUrl)
      }
      Xml.withinElementSync("scale") {
        writer.writeAttribute("x", parameters.voxelSize.map(_.factor.x).getOrElse(-1).toString)
        writer.writeAttribute("y", parameters.voxelSize.map(_.factor.y).getOrElse(-1).toString)
        writer.writeAttribute("z", parameters.voxelSize.map(_.factor.z).getOrElse(-1).toString)
        parameters.voxelSize.foreach { scale =>
          writer.writeAttribute("unit", scale.unit.toString)
        }
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
        parameters.editPositionAdditionalCoordinates.foreach(writeAdditionalCoordinateValue)
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
      if (parameters.additionalAxisProtos.nonEmpty) {
        Xml.withinElementSync("additionalAxes") {
          parameters.additionalAxisProtos.foreach(a => {
            Xml.withinElementSync("additionalAxis") {
              writer.writeAttribute("name", a.name)
              writer.writeAttribute("index", a.index.toString)
              writer.writeAttribute("start", a.bounds.x.toString)
              writer.writeAttribute("end", a.bounds.y.toString)
            }
          })
        }
      }
    }

  // Write volume things from FetchedAnnotationLayer. Caller must ensure that it is a volume annotation layer
  private def writeVolumeThings(volumeLayer: FetchedAnnotationLayer,
                                index: Int,
                                isSingle: Boolean,
                                volumeFilename: Option[String],
                                skipVolumeData: Boolean,
                                volumeDataZipFormat: VolumeDataZipFormat)(implicit writer: XMLStreamWriter): Unit =
    Xml.withinElementSync("volume") {
      writer.writeAttribute("id", index.toString)
      writer.writeAttribute("name", volumeLayer.name)
      if (!skipVolumeData) {
        writer.writeAttribute("location", volumeFilename.getOrElse(volumeLayer.volumeDataZipName(index, isSingle)))
        writer.writeAttribute("format", volumeDataZipFormat.toString)
      }
      volumeLayer.tracing match {
        case Right(volumeTracing) =>
          volumeTracing.fallbackLayer.foreach(writer.writeAttribute("fallbackLayer", _))
          volumeTracing.largestSegmentId.foreach(id => writer.writeAttribute("largestSegmentId", id.toString))
          if (!volumeTracing.hasEditableMapping.getOrElse(false)) {
            volumeTracing.mappingName.foreach { mappingName =>
              writer.writeAttribute("mappingName", mappingName)
            }
            if (volumeTracing.mappingIsLocked.getOrElse(false)) {
              writer.writeAttribute("mappingIsLocked", true.toString)
            }
          }
          if (skipVolumeData) {
            writer.writeComment(f"Note that volume data was omitted when downloading this annotation.")
          }
          writeVolumeSegmentInfos(volumeTracing.segments)
          Xml.withinElementSync("groups")(writeSegmentGroupsAsXml(volumeTracing.segmentGroups))
        case _ => ()
      }
    }

  private def writeVolumeSegmentInfos(segments: Seq[Segment])(implicit writer: XMLStreamWriter): Unit =
    Xml.withinElementSync("segments") {
      segments.foreach { s =>
        Xml.withinElementSync("segment") {
          writer.writeAttribute("id", s.segmentId.toString)
          s.name.foreach { n =>
            writer.writeAttribute("name", n)
          }
          s.creationTime.foreach { t =>
            writer.writeAttribute("created", t.toString)
          }
          s.anchorPosition.foreach { a =>
            writer.writeAttribute("anchorPositionX", a.x.toString)
            writer.writeAttribute("anchorPositionY", a.y.toString)
            writer.writeAttribute("anchorPositionZ", a.z.toString)
            s.anchorPositionAdditionalCoordinates.foreach(writeAdditionalCoordinateValue)
          }
          s.color.foreach(_ => writeColor(s.color))
          s.groupId.foreach(groupId => writer.writeAttribute("groupId", groupId.toString))
          if (s.metadata.nonEmpty)
            Xml.withinElementSync("metadata")(s.metadata.foreach(writeMetadataEntry))
        }
      }
    }

  private def writeMetadataEntry(p: MetadataEntryProto)(implicit writer: XMLStreamWriter): Unit =
    Xml.withinElementSync("metadataEntry") {
      writer.writeAttribute("key", p.key)
      p.stringValue.foreach { v =>
        writer.writeAttribute("stringValue", v)
      }
      p.boolValue.foreach { v =>
        writer.writeAttribute("boolValue", v.toString)
      }
      p.numberValue.foreach { v =>
        writer.writeAttribute("numberValue", v.toString)
      }
      p.stringListValue.zipWithIndex.foreach {
        case (v, index) =>
          writer.writeAttribute(s"stringListValue-$index", v)
      }
    }

  private def writeSkeletonThings(skeletonTracing: SkeletonTracing)(implicit writer: XMLStreamWriter): Unit = {
    writeTreesAsXml(skeletonTracing.trees)
    Xml.withinElementSync("branchpoints")(
      writeBranchPointsAsXml(skeletonTracing.trees.flatMap(_.branchPoints).sortBy(-_.createdTimestamp)))
    Xml.withinElementSync("comments")(writeCommentsAsXml(skeletonTracing.trees.flatMap(_.comments)))
    Xml.withinElementSync("groups")(writeTreeGroupsAsXml(skeletonTracing.treeGroups))
  }

  private def writeTreesAsXml(trees: Seq[Tree])(implicit writer: XMLStreamWriter): Unit =
    trees.foreach { t =>
      Xml.withinElementSync("thing") {
        writer.writeAttribute("id", t.treeId.toString)
        writeColor(t.color)
        writer.writeAttribute("name", t.name)
        t.groupId.foreach(groupId => writer.writeAttribute("groupId", groupId.toString))
        t.`type`.foreach(t => writer.writeAttribute("type", t.toString))
        Xml.withinElementSync("nodes")(writeNodesAsXml(t.nodes.sortBy(_.id)))
        Xml.withinElementSync("edges")(writeEdgesAsXml(t.edges))
        if (t.metadata.nonEmpty)
          Xml.withinElementSync("metadata")(t.metadata.foreach(writeMetadataEntry))
      }
    }

  private def writeNodesAsXml(nodes: Seq[Node])(implicit writer: XMLStreamWriter): Unit =
    nodes.toSet.foreach { (n: Node) => // toSet as workaround for some erroneously duplicate nodes in the db, this was not checked on upload until 2017
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
        writer.writeAttribute("inMag", n.mag.toString)
        writer.writeAttribute("bitDepth", n.bitDepth.toString)
        writer.writeAttribute("interpolation", n.interpolation.toString)
        writer.writeAttribute("time", n.createdTimestamp.toString)
        n.additionalCoordinates.foreach(writeAdditionalCoordinateValue)
      }
    }

  private def writeEdgesAsXml(edges: Seq[Edge])(implicit writer: XMLStreamWriter): Unit =
    edges.foreach { e =>
      Xml.withinElementSync("edge") {
        writer.writeAttribute("source", e.source.toString)
        writer.writeAttribute("target", e.target.toString)
      }
    }

  private def writeBranchPointsAsXml(branchPoints: Seq[BranchPoint])(implicit writer: XMLStreamWriter): Unit =
    branchPoints.foreach { b =>
      Xml.withinElementSync("branchpoint") {
        writer.writeAttribute("id", b.nodeId.toString)
        writer.writeAttribute("time", b.createdTimestamp.toString)
      }
    }

  private def writeCommentsAsXml(comments: Seq[Comment])(implicit writer: XMLStreamWriter): Unit =
    comments.foreach { c =>
      Xml.withinElementSync("comment") {
        writer.writeAttribute("node", c.nodeId.toString)
        writer.writeAttribute("content", c.content)
      }
    }

  private def writeTreeGroupsAsXml(treeGroups: Seq[TreeGroup])(implicit writer: XMLStreamWriter): Unit =
    treeGroups.foreach { t =>
      Xml.withinElementSync("group") {
        writer.writeAttribute("name", t.name)
        writer.writeAttribute("id", t.groupId.toString)
        writer.writeAttribute("isExpanded", t.isExpanded.getOrElse(true).toString)
        writeTreeGroupsAsXml(t.children)
      }
    }

  private def writeSegmentGroupsAsXml(treeGroups: Seq[SegmentGroup])(implicit writer: XMLStreamWriter): Unit =
    treeGroups.foreach { t =>
      Xml.withinElementSync("group") {
        writer.writeAttribute("name", t.name)
        writer.writeAttribute("id", t.groupId.toString)
        writeSegmentGroupsAsXml(t.children)
      }
    }

  private def writeMetaData(annotationOpt: Option[Annotation], userOpt: Option[User], taskOpt: Option[Task])(
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
      writer.writeAttribute("content", Instant.now.epochMillis.toString)
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

  private def writeBoundingBox(b: BoundingBoxProto)(implicit writer: XMLStreamWriter): Unit = {
    writer.writeAttribute("topLeftX", b.topLeft.x.toString)
    writer.writeAttribute("topLeftY", b.topLeft.y.toString)
    writer.writeAttribute("topLeftZ", b.topLeft.z.toString)
    writer.writeAttribute("width", b.width.toString)
    writer.writeAttribute("height", b.height.toString)
    writer.writeAttribute("depth", b.depth.toString)
  }

  private def writeColor(color: Option[ColorProto])(implicit writer: XMLStreamWriter): Unit = {
    writer.writeAttribute("color.r", color.map(_.r.toString).getOrElse(""))
    writer.writeAttribute("color.g", color.map(_.g.toString).getOrElse(""))
    writer.writeAttribute("color.b", color.map(_.b.toString).getOrElse(""))
    writer.writeAttribute("color.a", color.map(_.a.toString).getOrElse(""))
  }

  private def writeAdditionalCoordinateValue(additionalCoordinate: AdditionalCoordinateProto)(
      implicit writer: XMLStreamWriter): Unit =
    writer.writeAttribute(s"additionalCoordinate-${additionalCoordinate.name}", additionalCoordinate.value.toString)
}
