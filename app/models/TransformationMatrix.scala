package models
import brainflight.tools.geometry.Vector3D

case class TransformationMatrix( value: List[Float] ) {
  /** 
   * Extract the translation from the transformation matrix
   */
  def extractTranslation : Option[Vector3D] =
    value match {
      case matrix if matrix.size >= 16 =>
        Some( new Vector3D( matrix( 12 ), matrix( 13 ), matrix( 14 ) ) )
      case _ =>
        None
    }
}

object TransformationMatrix{
  val defaultSize = 16
}