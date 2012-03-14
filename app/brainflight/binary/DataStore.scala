package brainflight.binary

abstract class DataStore {
  
	def load(point: Tuple3[Int, Int, Int]): Byte
	
	def cleanUp()
}