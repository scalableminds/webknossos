
import re
import os, fnmatch, math
from optparse import OptionParser

COLORS = [
		[0,0,1],[1,0,0],[0,1,0],[0.7, 0.7, 0.7],[0.8, 0.3, 0.2],[0.3, 0.6, 0.4],[0.3, 0.3, 0.3],[0.5, 0.5, 0.9],[0.9, 0.9, 0.6],[0.5, 0.5, 0.5],[0.7, 0.9, 0.7],[0.4, 0.9, 0.4],[0.9, 0.5, 0.6],[0.7, 0.2, 0.2],[0.3, 0.4, 0.5]		]

spacereg = re.compile(r" +")
slashreg = re.compile(r"/")

'''Locate all files matching supplied filename pattern in and below
supplied root directory.'''
def locate(pattern, root=os.curdir):
    for path, dirs, files in os.walk(os.path.abspath(root)):
        for filename in fnmatch.filter(files, pattern):
            yield os.path.join(path, filename)

def parseCommandLine():
    parser = OptionParser()
    parser.add_option("-p", "--path", dest="path", help="path to obj files",  default=".", type="string")
    parser.add_option("-c", "--color", dest="color", help="set a specific color", default=[], nargs=3, type="float")
    parser.add_option("-j","--js", dest="JsOutput", help="enable output of .js file", default=0, nargs=1)

    (options, args) = parser.parse_args()
    return options

'''3d vector calculations.
Code is base on javascript mjs math library'''
class V3:
    @staticmethod
    def normalize(vector):
        if vector == [0,0,0]: return [0,0,0]

        factor = 1.0 / V3.length(vector)
        return V3.multiply(vector, factor)


    '''Calculate dot product of two vectors'''
    @staticmethod
    def dot(vec1, vec2):
        return vec1[0] * vec2[0] + vec1[1] * vec2[1] + vec1[2] * vec2[2]

    '''Calculate cross product of two vectors'''
    @staticmethod
    def cross(vec1, vec2):
        result = []
        result.append( vec1[1] * vec2[2] - vec1[2] * vec2[1] )
        result.append( vec1[2] * vec2[0] - vec1[0] * vec2[2] )
        result.append( vec1[0] * vec2[1] - vec1[1] * vec2[0] )
        return result

    @staticmethod
    def length(vector):
        return math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2])

    @staticmethod   
    def add(vec1, vec2):
        result = []
        result.append( vec2[0] + vec1[0] )
        result.append( vec2[1] + vec1[1] )
        result.append( vec2[2] + vec1[2] )

        return result

    @staticmethod   
    def subtract(vec1, vec2):
        result = []
        result.append( vec2[0] - vec1[0] )
        result.append( vec2[1] - vec1[1] )
        result.append( vec2[2] - vec1[2] )

        return result

    @staticmethod
    def multiply(vector, scalar):
        for i in range(0,3):
            vector[i] *= scalar
        return vector

    @staticmethod
    def divide(vector, scalar):
        if scalar == 0 : return vector
        return V3.multiply(vector, 1 / scalar)




