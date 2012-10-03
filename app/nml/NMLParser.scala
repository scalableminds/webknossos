package nml

import scala.xml.XML
import models.DataSet
import models.graph.{ Experiment, Tree, Edge }
import models.graph
import models.Color
import brainflight.tools.ExtendedTypes._
import brainflight.tools.geometry.Point3D
import scala.xml.Node
import scala.xml.NodeSeq
import play.api.Logger
import models.graph.Tree
import java.io.File
import models.BranchPoint
import brainflight.tools.geometry.Scale

class NMLParser(file: File) {
  val DEFAULT_EDIT_POSITION = Point3D(0, 0, 0)
  val DEFAULT_TIME = 0
  val DEFAULT_ACTIVE_NODE_ID = 1
  val DEFAULT_COLOR = Color(1, 0, 0, 0)
  val DEFAULT_VIEWPORT = 0
  val DEFAULT_RESOLUTION = 0
  val DEFAULT_TIMESTAMP = 0

  def parse = {
    val data = XML.loadFile(file)
    println("test")
    for {
      parameters <- (data \ "parameters")
      dataSetId <- (parameters \ "experiment" \ "@name")
      scale <- parseScale(parameters \ "scale")
      dataSet <- DataSet.findOneByName(dataSetId.text)
    } yield {
      println("reached")
      val activeNodeId = parseActiveNode(parameters \ "activeNode")
      val editPosition = parseEditPosition(parameters \ "editPosition")
      val time = parseTime(parameters \ "time")
      val trees = verifyTrees((data \ "thing").flatMap(parseTree).toList)

      val branchPoints = (data \ "branchpoints" \ "branchpoint").flatMap(parseBranchPoint(trees))
      Experiment(dataSet._id, trees, branchPoints.toList, time, activeNodeId, scale, editPosition)
    }
  }

  def verifyTrees(trees: List[Tree]): List[Tree] = {
    trees
    //trees.flatMap(splitIntoComponents)
  }

  /*def componentsContainNode(components: List[Tree], node: models.graph.Node) = 
    components.flatMap(_.nodes).find( _.id == node.id).isDefined

  def splitIntoComponents(tree: Tree) = {
    def split(components: List[Tree], nodes: List[models.graph.Node]) = nodes match {
      case node :: tail =>
        componentsContainNode(components, node)
        split(components, tail)
      case _ =>
        components
    }

    split(Nil, tree.nodes)
  }*/

  def parseActiveNode(node: NodeSeq) = {
    (node \ "@id").text.toIntOpt.getOrElse(DEFAULT_ACTIVE_NODE_ID)
  }

  def parseTime(node: NodeSeq) = {
    (node \ "@ms").text.toIntOpt.getOrElse(DEFAULT_TIME)
  }
  def parseEditPosition(node: NodeSeq) = {
    node.headOption.flatMap(parsePoint3D).getOrElse(DEFAULT_EDIT_POSITION)
  }

  def parseBranchPoint(trees: List[Tree])(node: Node) = {
    ((node \ "@id").text).toIntOpt.map(id =>
      BranchPoint(id))
  }

  def parsePoint3D(node: Node) = {
    for {
      x <- ((node \ "@x").text).toIntOpt
      y <- ((node \ "@y").text).toIntOpt
      z <- ((node \ "@z").text).toIntOpt
    } yield Point3D(x, y, z)
  }

  def parseScale(nodes: NodeSeq) = {
    nodes.headOption.flatMap(node =>
      for {
        x <- ((node \ "@x").text).toFloatOpt
        y <- ((node \ "@y").text).toFloatOpt
        z <- ((node \ "@z").text).toFloatOpt
      } yield Scale(x, y, z))
  }

  def parseColor(node: Node) = {
    (for {
      colorRed <- ((node \ "@color.r").text).toFloatOpt
      colorBlue <- ((node \ "@color.g").text).toFloatOpt
      colorGreen <- ((node \ "@color.b").text).toFloatOpt
      colorAlpha <- ((node \ "@color.a").text).toFloatOpt
    } yield {
      Color(colorRed, colorBlue, colorGreen, colorAlpha)
    }) getOrElse( DEFAULT_COLOR )
  }

  def parseTree(tree: Node): Option[Tree] = {
    (for {
      id <- ((tree \ "@id").text).toIntOpt    
    } yield {
      val color = parseColor(tree)
      Logger.debug("Parsing tree Id: %d".format(id))
      val nodes = (tree \ "nodes" \ "node").flatMap(parseNode).toMap

      val edges = (tree \ "edges" \ "edge").flatMap(parseEdge(nodes)).toList

      if (nodes.size > 0)
        Some(Tree(id, nodes.values.toList, edges, color))
      else
        None
    }).flatMap(x => x)
  }

  def findRootNode(treeNodes: Map[Int, Node], edges: List[Edge]) = {
    val childNodes = edges.map(_.target)
    treeNodes.filter {
      case (id, node) => !childNodes.contains(node)
    }.foreach(println)
    treeNodes.find(node => !childNodes.contains(node)).map(_._2)
  }

  def parseEdge(treeNodes: Map[Int, graph.Node])(edge: Node) = {
    for {
      source <- ((edge \ "@source").text).toIntOpt
      target <- ((edge \ "@target").text).toIntOpt
      //sourceNode <- treeNodes.get(source)
      //targetNode <- treeNodes.get(target)
    } yield {
      Edge(source, target)
    }
  }
  
  def parseViewport(node: NodeSeq) = {
    ((node \ "@inVp").text).toIntOpt.getOrElse(DEFAULT_VIEWPORT)
  }
  
  def parseResolution(node: NodeSeq) = {
    ((node \ "@inMag").text).toIntOpt.getOrElse(DEFAULT_RESOLUTION)
  }  
 
  def parseTimestamp(node: NodeSeq) = {
    ((node \ "@time").text).toIntOpt.getOrElse(DEFAULT_TIMESTAMP)
  }  
    
  def parseNode(node: Node) = {
    for {
      id <- ((node \ "@id").text).toIntOpt
      radius <- ((node \ "@radius").text).toFloatOpt
      position <- parsePoint3D(node)
    } yield {
      val viewport = parseViewport(node)
      val resolution = parseResolution(node)
      val timestamp = parseTimestamp(node)   
      (id -> graph.Node(id, radius, position, viewport, resolution, timestamp))
    }
  }
}