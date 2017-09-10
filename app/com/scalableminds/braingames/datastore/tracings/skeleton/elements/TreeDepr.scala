/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings.skeleton.elements

import javax.xml.stream.XMLStreamWriter

import com.scalableminds.util.image.Color
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.xml.{XMLWrites, Xml}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsObject, Json, OWrites, Writes}

case class TreeDepr(
                 treeId: Int,
                 nodes: Set[NodeDepr],
                 edges: Set[EdgeDepr],
                 color: Option[Color],
                 branchPoints: List[BranchPointDepr],
                 comments: List[CommentDepr],
                 name: String = "") {

  def timestamp =
    if (nodes.isEmpty)
      System.currentTimeMillis()
    else
      nodes.minBy(_.timestamp).timestamp

  def addNodes(ns: Set[NodeDepr]) = this.copy(nodes = nodes ++ ns)

  def addEdges(es: Set[EdgeDepr]) = this.copy(edges = edges ++ es)

  def --(t: TreeDepr) = {
    this.copy(nodes = nodes -- t.nodes, edges = edges -- t.edges)
  }

  def ++(t: TreeDepr) = {
    this.copy(nodes = nodes ++ t.nodes, edges = edges ++ t.edges)
  }

  def changeTreeId(updatedTreeId: Int) = {
    this.copy(treeId = updatedTreeId)
  }

  def changeName(newName: String) = {
    this.copy(name = newName)
  }

  def applyNodeMapping(f: Int => Int) = {
    this.copy(
      nodes = nodes.map(node => node.copy(id = f(node.id))),
      edges = edges.map(edge => edge.copy(source = f(edge.source), target = f(edge.target))),
      comments = comments.map(comment => comment.copy(node = f(comment.node))),
      branchPoints = branchPoints.map(bp => bp.copy(id = f(bp.id)))
    )
  }

  def addNamePrefix(prefix: String) = {
    this.copy(name = prefix + name)
  }
}

object TreeDepr {

  implicit class OWritesExt[A](owrites: OWrites[A]) {
    def withValue[B : Writes](key: String, value: A => B): OWrites[A] =
      new OWrites[A] {
        def writes(a: A): JsObject = owrites.writes(a) ++ Json.obj(key -> value(a))
      }
  }

  implicit val jsonWrites = Json.writes[TreeDepr].withValue("timestamp", _.timestamp)
  implicit val jsonReads = Json.reads[TreeDepr]

  implicit object TreeLikeXMLWrites extends XMLWrites[TreeDepr] with LazyLogging {
    def writes(t: TreeDepr)(implicit writer: XMLStreamWriter): Fox[Boolean] = {
      Xml.withinElement("thing") {
        writer.writeAttribute("id", t.treeId.toString)
        writer.writeAttribute("color.r", t.color.map(_.r.toString).getOrElse(""))
        writer.writeAttribute("color.g", t.color.map(_.g.toString).getOrElse(""))
        writer.writeAttribute("color.b", t.color.map(_.b.toString).getOrElse(""))
        writer.writeAttribute("color.a", t.color.map(_.a.toString).getOrElse(""))
        writer.writeAttribute("name", t.name)
        for {
          _ <- Xml.withinElement("nodes")(Xml.toXML(t.nodes.toList.sortBy(_.id)))
          _ <- Xml.withinElement("edges")(Xml.toXML(t.edges.toList))
        } yield true
      }
    }
  }
}
