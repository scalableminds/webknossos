package oxalis.nml

import scala.xml.{Node => XMLNode, Elem, XML, NodeSeq}
import models.binary.DataSet
import com.scalableminds.util.image.Color
import com.scalableminds.util.tools.ExtendedTypes.ExtendedString
import com.scalableminds.util.geometry.Point3D
import play.api.Logger
import java.io.File
import com.scalableminds.util.geometry.Scale
import models.user.User
import com.sun.org.apache.xerces.internal.impl.io.MalformedByteSequenceException
import java.io.InputStream
import java.io.FileInputStream
import net.liftweb.common.{Full, Box, Failure}
import net.liftweb.common.Box._
import utils._
import scala.annotation.tailrec
import models.tracing.skeleton.SkeletonTracing

object NMLParser {

  def createUniqueIds(trees: Seq[Tree]) = {
    trees.foldLeft(List[Tree]()) {
      (l, t) =>
        if (l.isEmpty || l.find(_.treeId == t.treeId).isEmpty)
          t :: l
        else {
          val alteredId = (l.maxBy(_.treeId).treeId + 1)
          t.copy(treeId = alteredId) :: l
        }
    }
  }

  def parse(input: InputStream) = {
    val result = NMLParserImpl.parse(input)
    input.close()
    result
  }

  def parse(file: File): Box[NML] = {
    parse(new FileInputStream(file))
  }

  private object NMLParserImpl {
    val DEFAULT_TIME = 0L
    val DEFAULT_ACTIVE_NODE_ID = 1
    val DEFAULT_COLOR = Color(1, 0, 0, 0)
    val DEFAULT_VIEWPORT = 0
    val DEFAULT_RESOLUTION = 0
    val DEFAULT_BITDEPTH = 0
    val DEFAULT_INTERPOLATION = false
    val DEFAULT_TIMESTAMP = 0L

    def parse(in: InputStream): Box[NML] = {
      try {
        val data = XML.load(in)
        for {
          parameters <- (data \ "parameters").headOption ?~ "No parameters section found"
          scale <- parseScale(parameters \ "scale") ?~ "Couldn't parse scale"
          trees <- extractTrees(data \ "thing")
        } yield {
          val dataSetName = parseDataSetName(parameters \ "experiment")
          val activeNodeId = parseActiveNode(parameters \ "activeNode")
          val editPosition = parseEditPosition(parameters \ "editPosition") // STARTPOS
          val time = parseTime(parameters \ "time")
          val comments = parseComments(data \ "comments")
          val branchPoints = parseBranchPoints(data \ "branchpoints")
          Logger.debug(s"Parsed NML file. Trees: ${trees.size}")
          NML(dataSetName, trees.toList, branchPoints.toList, time, activeNodeId, scale, editPosition, comments.toList)
        }
      } catch {
        case e: Exception =>
          Logger.error("Failed to parse NML due to " + e)
          Failure("Couldn't parse nml: " + e.toString)
      }
    }

    def extractTrees(treeNodes: NodeSeq) = {
      validateTrees(parseTrees(treeNodes)).map(transformTrees)
    }

    def validateTrees(trees: Seq[Tree]): Box[Seq[Tree]] = {
      val nodeIds = trees.flatMap(_.nodes).map(_.id)
      nodeIds.size == nodeIds.distinct.size match {
        case true => Full(trees)
        case false => Failure("NML contains nodes with duplicate ids.")
      }
    }

    private def transformTrees(trees: Seq[Tree]): Seq[Tree] = {
      NMLParser.createUniqueIds(trees.flatMap(splitIntoComponents))
    }

    private def splitIntoComponents(tree: Tree): List[Tree] = {
      def emptyTree = tree.copy(nodes = Set.empty, edges = Set.empty)

      val t = System.currentTimeMillis()

      val nodeMap = tree.nodes.map(n => n.id -> n).toMap

      @tailrec
      def buildTreeFromNode(nodesToProcess: List[Node], treeReminder: Tree, component: Tree = emptyTree): (Tree, Tree) = {
        if (!nodesToProcess.isEmpty) {
          val node = nodesToProcess.head
          val tail = nodesToProcess.tail
          val connectedEdges = treeReminder.edges.filter(e => e.source == node.id || e.target == node.id)

          val connectedNodes = connectedEdges.flatMap {
            case Edge(s, t) if s == node.id => nodeMap.get(t)
            case Edge(s, t) if t == node.id => nodeMap.get(s)
          }

          val currentComponent = tree.copy(nodes = connectedNodes + node, edges = connectedEdges)
          val r = (component ++ currentComponent)
          buildTreeFromNode(tail ::: connectedNodes.toList, treeReminder -- currentComponent, r)
        } else
          (treeReminder -> component)
      }

      var treeToProcess = tree

      var components = List[Tree]()

      while (!treeToProcess.nodes.isEmpty) {
        val (treeReminder, component) = buildTreeFromNode(treeToProcess.nodes.head :: Nil, treeToProcess)
        treeToProcess = treeReminder
        components ::= component
      }
      Logger.trace("Connected components calculation: " + (System.currentTimeMillis() - t))
      components.map(
        _.copy(
          color = tree.color,
          treeId = tree.treeId))
    }

    private def parseTrees(treeNodes: NodeSeq) = {
      treeNodes.flatMap(parseTree)
    }

    private def parseDataSetName(node: NodeSeq) = {
      val rawDataSetName = (node \ "@name").text
      val magRx = "_mag[0-9]*$".r
      magRx.replaceAllIn(rawDataSetName, "")
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

    private def parseBranchPoints(branchPoints: NodeSeq) = {
      for {
        branchPoint <- branchPoints \ "branchpoint"
        nodeId <- ((branchPoint \ "@id").text).toIntOpt
      } yield BranchPoint(nodeId)
    }

    private def parsePoint3D(node: XMLNode) = {
      for {
        x <- ((node \ "@x").text).toIntOpt
        y <- ((node \ "@y").text).toIntOpt
        z <- ((node \ "@z").text).toIntOpt
      } yield Point3D(x, y, z)
    }

    private def parseScale(nodes: NodeSeq) = {
      nodes.headOption.flatMap(node =>
        for {
          x <- ((node \ "@x").text).toFloatOpt
          y <- ((node \ "@y").text).toFloatOpt
          z <- ((node \ "@z").text).toFloatOpt
        } yield Scale(x, y, z))
    }

    private def parseColorOpt(node: XMLNode) = {
      for {
        colorRed <- ((node \ "@color.r").text).toFloatOpt
        colorBlue <- ((node \ "@color.g").text).toFloatOpt
        colorGreen <- ((node \ "@color.b").text).toFloatOpt
        colorAlpha <- ((node \ "@color.a").text).toFloatOpt
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

    private def parseTree(tree: XMLNode): Option[Tree] = {
      ((tree \ "@id").text).toIntOpt.flatMap {
        id =>
          val color = parseColor(tree)
          val name = parseName(tree)
          Logger.trace("Parsing tree Id: %d".format(id))
          (tree \ "nodes" \ "node").flatMap(parseNode) match {
            case nodes if nodes.size > 0 =>
              val edges = (tree \ "edges" \ "edge").flatMap(parseEdge).toSet
              Some(Tree(id, nodes.toSet, edges, color, name))
            case _ =>
              None
          }
      }
    }

    private def parseComments(comments: NodeSeq) = {
      for {
        comment <- comments \ "comment"
        nodeId <- ((comment \ "@node").text).toIntOpt
      } yield {
        val content = (comment \ "@content").text
        Comment(nodeId, content)
      }
    }

    private def findRootNode(treeNodes: Map[Int, XMLNode], edges: List[Edge]) = {
      val childNodes = edges.map(_.target)
      treeNodes.filter {
        case (id, node) => !childNodes.contains(node)
      }.foreach(println)
      treeNodes.find(node => !childNodes.contains(node)).map(_._2)
    }

    private def parseEdge(edge: XMLNode) = {
      for {
        source <- ((edge \ "@source").text).toIntOpt
        target <- ((edge \ "@target").text).toIntOpt
      } yield {
        Edge(source, target)
      }
    }

    private def parseViewport(node: NodeSeq) = {
      ((node \ "@inVp").text).toIntOpt.getOrElse(DEFAULT_VIEWPORT)
    }

    private def parseResolution(node: NodeSeq) = {
      ((node \ "@inMag").text).toIntOpt.getOrElse(DEFAULT_RESOLUTION)
    }

    private def parseBitDepth(node: NodeSeq) = {
      ((node \ "@bitDepth").text).toIntOpt.getOrElse(DEFAULT_BITDEPTH)
    }

    private def parseInterpolation(node: NodeSeq) = {
      ((node \ "@interpolation").text).toBooleanOpt.getOrElse(DEFAULT_INTERPOLATION)
    }

    private def parseTimestamp(node: NodeSeq) = {
      ((node \ "@time").text).toLongOpt.getOrElse(DEFAULT_TIMESTAMP)
    }

    private def parseNode(node: XMLNode) = {
      for {
        id <- ((node \ "@id").text).toIntOpt
        radius <- ((node \ "@radius").text).toFloatOpt
        position <- parsePoint3D(node)
      } yield {
        val viewport = parseViewport(node)
        val resolution = parseResolution(node)
        val timestamp = parseTimestamp(node)
        val bitDepth = parseBitDepth(node)
        val interpolation = parseInterpolation(node)
        Node(id, position, Node.defaultRotation, radius, viewport, resolution, bitDepth, interpolation, timestamp)
      }
    }
  }

}
