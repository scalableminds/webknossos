package models.graph

case class Edge(source: Node, target: Node)

object Edge {
  def toXML(e: Edge) = {
    <edge source={ e.source.id.toString } target={ e.target.id.toString }/>
  }
}