package brainflight.tools

import brainflight.tools.ExtendedTypes._
import org.specs2.mutable.Specification

class ExtendedTypesTest extends Specification{
	"Extended byte array" should {
	  "be able to convert to float" in {
	    val b = Array[Byte](1,2,3,4)
	    b.toFloat must be equalTo 2.3879393E-38F
	  }
	  "subdivide into parts of length 1" in {
	    val b = Array[Byte](1,2,3,4,5)
	    val devided = b.subDivide(1)
	    
	    devided.size must be equalTo 5
	    devided.head.head must be equalTo 1
	    devided.last.head must be equalTo 5	    
	  }
	  "subdivide into parts even if array is to short" in {
	    val b = Array[Byte](1,2,3,4,5)
	    val devided = b.subDivide(4)
	    
	    devided.size must be equalTo 2
	    devided.head.size must be equalTo 4
	    devided.last.size must be equalTo 1   
	  }
	  "don't subdivide if array is smaller than one part" in {
	    val b = Array[Byte](1,2,3,4,5)
	    val devided = b.subDivide(10)
	    
	    devided.size must be equalTo 1
	    devided.head.size must be equalTo 5
	  }
	}
	
	"Extended int" should {
	  "be able to convert to binary" in {
	    
	    42.toBinary must be equalTo Array[Byte](0,0,0,42)
	    
	    13371337.toBinary must be equalTo Array[Byte](0,-52,7,-55)
	    
	    -123456.toBinary must be equalTo Array[Byte](-1,-2,29,-64)
	  }
	}
	
	"Extended float" should {
	  "be able to convert to binary" in {
	    
	    42.0F.toBinary must be equalTo Array[Byte](66, 40, 0, 0)
	    
	    1337.1337F.toBinary must be equalTo Array[Byte](68, -89, 36, 71)
	    
	    -123.456F.toBinary must be equalTo Array[Byte](-62, -10, -23, 121)
	  }
	}
	
	"Extended double" should {
	  "be able to convert to binary" in {
	    
	    42.0.toBinary must be equalTo Array[Byte](64, 69, 0, 0, 0, 0, 0, 0)
	    
	    1337.1337.toBinary must be equalTo Array[Byte](64, -108, -28, -120, -24, -89, 29, -25)
	    
	    -123.456.toBinary must be equalTo Array[Byte](-64, 94, -35, 47, 26, -97, -66, 119)
	  }
	  "decide if a value is near zero" in {
	    
	    42.0.isNearZero must be equalTo false
	    
	    -42.0.isNearZero must be equalTo false
	    
	    0.0000000000000001.isNearZero should be equalTo true
	    
	    -0.0000000000000001.isNearZero should be equalTo true
	  }
	}
}