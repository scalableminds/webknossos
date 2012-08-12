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

class NMLParser(file: File) {
  def parse = {
    val data = XML.loadFile(file)

    for {
      parameters <- (data \ "parameters")
      dataSetId <- (parameters \ "experiment" \ "@name")
      editPosition <- parseEditPosition(parameters \ "editPosition")
      time <- ((parameters \ "time" \ "@ms").text).toIntOpt
      activeNodeId <- ((parameters \ "activeNode" \ "@id").text).toIntOpt
      dataSet <- DataSet.findOneByName(dataSetId.text)
    } yield {
      val trees = (data \ "thing").flatMap(parseTree)
      val branchPoints = (data \ "branchpoints" \ "branchpoint").flatMap(parseBranchPoint)
      Experiment(dataSet._id, trees.toList, branchPoints.toList, time, activeNodeId, editPosition)
    }
  }

  def parseEditPosition(node: NodeSeq) = {
    node.headOption.flatMap(parsePoint3D)
  }
  
  def parseBranchPoint(node: Node) = {
    ((node \ "@id").text).toIntOpt.map( id =>
    BranchPoint(id)
    )
  }

  def parsePoint3D(node: Node) = {
    for {
      x <- ((node \ "@x").text).toIntOpt
      y <- ((node \ "@y").text).toIntOpt
      z <- ((node \ "@z").text).toIntOpt
    } yield Point3D(x, y, z)
  }

  def parseColor(node: Node) = {
    for {
      colorRed <- ((node \ "@color.r").text).toFloatOpt
      colorBlue <- ((node \ "@color.g").text).toFloatOpt
      colorGreen <- ((node \ "@color.b").text).toFloatOpt
      colorAlpha <- ((node \ "@color.a").text).toFloatOpt
    } yield {
      Color(colorRed, colorBlue, colorGreen, colorAlpha)
    }
  }

  def parseTree(tree: Node): Option[Tree] = {
    for {
      id <- ((tree \ "@id").text).toIntOpt
      color <- parseColor(tree)
    } yield {
      Logger.debug("Parsing tree Id: %d".format(id))
      val nodes = (tree \ "nodes" \ "node").flatMap(parseNode).toMap

      val edges = (tree \ "edges" \ "edge").flatMap(parseEdge(nodes)).toList

      Tree(id, nodes.values.toList, edges, color)
    }
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
      sourceNode <- treeNodes.get(source)
      targetNode <- treeNodes.get(target)
    } yield {
      Edge(sourceNode, targetNode)
    }
  }

  def parseNode(node: Node) = {
    for {
      id <- ((node \ "@id").text).toIntOpt
      radius <- ((node \ "@radius").text).toFloatOpt
      position <- parsePoint3D(node)
      viewport <- ((node \ "@inVp").text).toIntOpt
      resolution <- ((node \ "@inMag").text).toIntOpt
      timestamp <- ((node \ "@time").text).toIntOpt
    } yield {
      (id -> graph.Node(id, radius, position, viewport, resolution, timestamp))
    }
  }
}