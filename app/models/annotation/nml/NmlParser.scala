/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation.nml

import java.io.InputStream

import com.scalableminds.braingames.binary.models.datasource.ElementClass
import com.scalableminds.braingames.datastore.SkeletonTracing._
import com.scalableminds.braingames.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.braingames.datastore.tracings.ProtoGeometryImplicits
import com.scalableminds.braingames.datastore.tracings.skeleton.{NodeDefaults, SkeletonTracingDefaults}
import com.scalableminds.braingames.datastore.tracings.volume.Volume
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box._
import net.liftweb.common.{Box, Empty, Failure, Full}

import scala.xml.{NodeSeq, XML, Node => XMLNode}

object NmlParser extends LazyLogging with ProtoGeometryImplicits {

  val DEFAULT_TIME = 0L

  val DEFAULT_ACTIVE_NODE_ID = 1

  val DEFAULT_COLOR = Color(1, 0, 0, 0)

  val DEFAULT_VIEWPORT = 0

  val DEFAULT_RESOLUTION = 0

  val DEFAULT_BITDEPTH = 0

  val DEFAULT_INTERPOLATION = false

  val DEFAULT_TIMESTAMP = 0L

  def parse(name: String, nmlInputStream: InputStream): Box[(Either[SkeletonTracing, (VolumeTracing, String)], String)] = {
    try {
      val data = XML.load(nmlInputStream)
      for {
        parameters <- (data \ "parameters").headOption ?~ "No parameters section found"
        scale <- parseScale(parameters \ "scale") ?~ "Couldn't parse scale"
        time = parseTime(parameters \ "time")
        comments = parseComments(data \ "comments")
        branchPoints = parseBranchPoints(data \ "branchpoints", time)
        trees <- extractTrees(data \ "thing", branchPoints, comments)
        volumes = extractVolumes(data \ "volume")
      } yield {
        val dataSetName = parseDataSetName(parameters \ "experiment")
        val description = parseDescription(parameters \ "experiment")
        val activeNodeId = parseActiveNode(parameters \ "activeNode")
        val editPosition = parseEditPosition(parameters \ "editPosition").getOrElse(SkeletonTracingDefaults.editPosition)
        val editRotation = parseEditRotation(parameters \ "editRotation").getOrElse(SkeletonTracingDefaults.editRotation)
        val zoomLevel = parseZoomLevel(parameters \ "zoomLevel").getOrElse(SkeletonTracingDefaults.zoomLevel)
        val userBoundingBox = parseUserBoundingBox(parameters \ "userBoundingBox")

        logger.debug(s"Parsed NML file. Trees: ${trees.size}, Volumes: ${volumes.size}")

        if (volumes.size >= 1) {
          (Right(VolumeTracing(None, BoundingBox.empty, time, dataSetName, editPosition, editRotation, ElementClass.uint32, None, 0, 0, zoomLevel), volumes.head.location), description)
        } else {
          (Left(SkeletonTracing(dataSetName, trees, time, None, activeNodeId,
            editPosition, editRotation, zoomLevel, version = 0, userBoundingBox)), description)
        }
      }
    } catch {
      case e: org.xml.sax.SAXParseException if e.getMessage.startsWith("Premature end of file") =>
        logger.debug(s"Tried  to parse empty NML file $name.")
        Empty
      case e: org.xml.sax.SAXParseException =>
        logger.debug(s"Failed to parse NML $name due to " + e)
        Failure(s"Failed to parse NML '$name'. Error in Line ${e.getLineNumber} " +
          s"(column ${e.getColumnNumber}): ${e.getMessage}")
      case e: Exception =>
        logger.error(s"Failed to parse NML $name due to " + e)
        Failure(s"Failed to parse NML '$name': " + e.toString)
    }
  }

  def extractTrees(treeNodes: NodeSeq, branchPoints: Seq[BranchPoint], comments: Seq[Comment]) = {
    validateTrees(parseTrees(treeNodes, branchPoints, comments))
  }

  def extractVolumes(volumeNodes: NodeSeq) = {
    volumeNodes.map(node => Volume((node \ "@location").text))
  }

  def validateTrees(trees: Seq[Tree]): Box[Seq[Tree]] = {
    for {
      duplicateCheck <- checkForDuplicateIds(trees)
      nodesInEdges <- allNodesInEdgesExist(duplicateCheck)
      nodesBelongToEdges <- nodesAreInEdges(nodesInEdges)
      treesAreConnected <- checkTreesAreConnected(nodesBelongToEdges)
    } yield {
      treesAreConnected
    }
  }

  private def checkForDuplicateIds(trees: Seq[Tree]): Box[Seq[Tree]] = {
    val nodeIds = trees.flatMap(_.nodes).map(_.id)
    nodeIds.size == nodeIds.distinct.size match {
      case true => Full(trees)
      case false => Failure("NML contains nodes with duplicate ids.")
    }
  }

  private def allNodesInEdgesExist(trees: Seq[Tree]) = {
    def treeLoop(trees: Seq[Tree]): Boolean = {
      if (trees.head.edges.isEmpty)
        if (trees.tail.isEmpty) true
        else treeLoop(trees.tail)
      else {
        edgeLoop(trees.head, trees.head.edges) match {
          case true => if (trees.tail.isEmpty) true else treeLoop(trees.tail)
          case false => false
        }
      }
    }

    def edgeLoop(tree: Tree, edges: Seq[Edge]): Boolean = {
      checkEdge(tree, edges.head) match {
        case true => if (edges.tail.isEmpty) true else edgeLoop(tree, edges.tail)
        case false => false
      }
    }

    def checkEdge(tree: Tree, edge: Edge) = {
      tree.nodes.map(node => node.id).contains(edge.target) && tree.nodes.map(node => node.id).contains(edge.source)
    }

    treeLoop(trees) match {
      case true => Full(trees)
      case false => Failure("Some Edges contain nodes that don't exist.")
    }
  }

  private def nodesAreInEdges(trees: Seq[Tree]) = {
    def treeLoop(trees: Seq[Tree]): Boolean = {
      if (trees.head.nodes.size == 1)
        if (trees.tail.isEmpty) true
        else treeLoop(trees.tail)
      else {
        nodeLoop(trees.head, trees.head.nodes) match {
          case true => if (trees.tail.isEmpty) true else treeLoop(trees.tail)
          case false => false
        }
      }
    }

    def nodeLoop(tree: Tree, nodes: Seq[Node]): Boolean = {
      checkNode(tree, nodes.head) match {
        case true => if (nodes.tail.isEmpty) true else nodeLoop(tree, nodes.tail)
        case false => false
      }
    }

    def checkNode(tree: Tree, node: Node) = {
      tree.edges.map(edge => edge.source).contains(node.id) || tree.edges.map(edge => edge.target).contains(node.id)
    }

    treeLoop(trees) match {
      case true => Full(trees)
      case false => Failure("Some Nodes don't belong to any edges.")
    }
  }

  private def checkTreesAreConnected(trees: Seq[Tree]) = {
    def treeLoop(trees: Seq[Tree]): Boolean = {
      treeTraversal(trees.head).size == trees.head.nodes.size match {
        case true => if (trees.tail.isEmpty) true else treeLoop(trees.tail)
        case false => false
      }
    }

    def treeTraversal(tree: Tree): Set[Int] = {
      def traverse(visited: Set[Int], remaining: Set[Int]): Set[Int] = {
        if (remaining.isEmpty) visited
        else {
          val foundNodesSource = tree.edges.filter(edge => edge.source == remaining.head).map(edge => edge.target)
          val foundNodesTarget = tree.edges.filter(edge => edge.target == remaining.head).map(edge => edge.source)
          traverse(visited + remaining.head, remaining.tail ++ ((foundNodesSource ++ foundNodesTarget).toSet[Int] -- visited))
        }
      }

      traverse(Set[Int](), Set[Int](tree.nodes.head.id))
    }

    treeLoop(trees) match {
      case true => Full(trees)
      case false => Failure("Some Trees are not connected.")
    }
  }

  private def parseTrees(treeNodes: NodeSeq, branchPoints: Seq[BranchPoint], comments: Seq[Comment]) = {
    treeNodes.flatMap(treeNode => parseTree(treeNode, branchPoints, comments))
  }

  private def parseUserBoundingBox(node: NodeSeq) = {
    node.headOption.flatMap(bb =>
      for {
        topLeftX <- (node \ "@topLeftX").text.toIntOpt
        topLeftY <- (node \ "@topLeftY").text.toIntOpt
        topLeftZ <- (node \ "@topLeftZ").text.toIntOpt
        width <- (node \ "@width").text.toIntOpt
        height <- (node \ "@height").text.toIntOpt
        depth <- (node \ "@depth").text.toIntOpt
      } yield BoundingBox(Point3D(topLeftX, topLeftY, topLeftZ), width, height, depth)
    )
  }

  private def parseDataSetName(node: NodeSeq) = {
    (node \ "@name").text
  }

  private def parseDescription(node: NodeSeq) = {
    (node \ "@description").text
  }

  private def parseActiveNode(node: NodeSeq) = {
    (node \ "@id").text.toIntOpt
  }

  private def parseTime(node: NodeSeq) = {
    (node \ "@ms").text.toLongOpt.getOrElse(DEFAULT_TIME)
  }

  private def parseEditPosition(node: NodeSeq) = {
    node.headOption.flatMap(parsePoint3D)
  }

  private def parseEditRotation(node: NodeSeq) = {
    node.headOption.flatMap(parseRotation)
  }

  private def parseZoomLevel(node: NodeSeq) = {
    (node \ "@zoom").text.toDoubleOpt
  }

  private def parseBranchPoints(branchPoints: NodeSeq, defaultTimestamp: Long) = {
    (branchPoints \ "branchpoint").zipWithIndex.flatMap {
      case (branchPoint, index) =>
        (branchPoint \ "@id").text.toIntOpt.map { nodeId =>
          val parsedTimestamp = (branchPoint \ "@time").text.toLongOpt
          val timestamp = parsedTimestamp.getOrElse(defaultTimestamp - index)
          BranchPoint(nodeId, timestamp)
        }
    }
  }

  private def parsePoint3D(node: XMLNode) = {
    for {
      x <- (node \ "@x").text.toIntOpt
      y <- (node \ "@y").text.toIntOpt
      z <- (node \ "@z").text.toIntOpt
    } yield Point3D(x, y, z)
  }

  private def parseRotation(node: NodeSeq) = {
    for {
      rotX <- (node \ "@rotX").text.toDoubleOpt
      rotY <- (node \ "@rotY").text.toDoubleOpt
      rotZ <- (node \ "@rotZ").text.toDoubleOpt
    } yield Vector3D(rotX, rotY, rotZ)
  }

  private def parseScale(nodes: NodeSeq) = {
    nodes.headOption.flatMap(node =>
      for {
        x <- (node \ "@x").text.toFloatOpt
        y <- (node \ "@y").text.toFloatOpt
        z <- (node \ "@z").text.toFloatOpt
      } yield Scale(x, y, z))
  }

  private def parseColorOpt(node: XMLNode) = {
    for {
      colorRed <- (node \ "@color.r").text.toFloatOpt
      colorBlue <- (node \ "@color.g").text.toFloatOpt
      colorGreen <- (node \ "@color.b").text.toFloatOpt
      colorAlpha <- (node \ "@color.a").text.toFloatOpt
    } yield {
      Color(colorRed, colorBlue, colorGreen, colorAlpha)
    }
  }

  private def parseColor(node: XMLNode) = {
    parseColorOpt(node)
  }

  private def parseName(node: XMLNode) = {
    (node \ "@name").text
  }

  private def parseTree(
                         tree: XMLNode,
                         branchPoints: Seq[BranchPoint],
                         comments: Seq[Comment]): Option[Tree] = {

    (tree \ "@id").text.toIntOpt.flatMap {
      id =>
        val color = parseColor(tree)
        val name = parseName(tree)
        logger.trace("Parsing tree Id: %d".format(id))
        (tree \ "nodes" \ "node").flatMap(parseNode) match {
          case parsedNodes if parsedNodes.nonEmpty =>
            val edges = (tree \ "edges" \ "edge").flatMap(parseEdge)
            val nodes = parsedNodes
            val nodeIds = nodes.map(_.id)
            val treeBP = branchPoints.filter(bp => nodeIds.contains(bp.nodeId)).toList
            val treeComments = comments.filter(bp => nodeIds.contains(bp.nodeId)).toList
            val createdTimestamp = if (nodes.isEmpty) System.currentTimeMillis() else parsedNodes.minBy(_.createdTimestamp).createdTimestamp
            Some(Tree(id, nodes, edges, color, treeBP, treeComments, name, createdTimestamp))
          case _ =>
            None
        }
    }
  }

  private def parseComments(comments: NodeSeq) = {
    for {
      comment <- comments \ "comment"
      nodeId <- (comment \ "@node").text.toIntOpt
    } yield {
      val content = (comment \ "@content").text
      Comment(nodeId, content)
    }
  }

  private def parseEdge(edge: XMLNode) = {
    for {
      source <- (edge \ "@source").text.toIntOpt
      target <- (edge \ "@target").text.toIntOpt
    } yield {
      Edge(source, target)
    }
  }

  private def parseViewport(node: NodeSeq) = {
    (node \ "@inVp").text.toIntOpt.getOrElse(DEFAULT_VIEWPORT)
  }

  private def parseResolution(node: NodeSeq) = {
    (node \ "@inMag").text.toIntOpt.getOrElse(DEFAULT_RESOLUTION)
  }

  private def parseBitDepth(node: NodeSeq) = {
    (node \ "@bitDepth").text.toIntOpt.getOrElse(DEFAULT_BITDEPTH)
  }

  private def parseInterpolation(node: NodeSeq) = {
    (node \ "@interpolation").text.toBooleanOpt.getOrElse(DEFAULT_INTERPOLATION)
  }

  private def parseTimestamp(node: NodeSeq) = {
    (node \ "@time").text.toLongOpt.getOrElse(DEFAULT_TIMESTAMP)
  }

  private def parseNode(node: XMLNode) = {
    for {
      id <- (node \ "@id").text.toIntOpt
      radius <- (node \ "@radius").text.toFloatOpt
      position <- parsePoint3D(node)
    } yield {
      val viewport = parseViewport(node)
      val resolution = parseResolution(node)
      val timestamp = parseTimestamp(node)
      val bitDepth = parseBitDepth(node)
      val interpolation = parseInterpolation(node)
      val rotation = parseRotation(node).getOrElse(NodeDefaults.rotation)
      Node(id, position, rotation, radius, viewport, resolution, bitDepth, interpolation, timestamp)
    }
  }

}
