package models
import brainflight.tools.geometry.Vector3D

case class TransformationMatrix( value: List[Float] ) {
  def extractTranslation =
    value match {
      case matrix if matrix.size >= 16 =>
        Some( Vector3D( matrix( 12 ), matrix( 13 ), matrix( 14 ) ) )
      case _ =>
        None
    }
}