package models

case class BranchPoint( matrix: TransformationMatrix ) extends Origin

object BranchPoint {

  def apply( fl: List[Float] ): BranchPoint =
    BranchPoint( TransformationMatrix( fl ) )
}