
import re
import os, fnmatch
from optparse import OptionParser

COLORS = [
		[0,0,1],[1,0,0],[0,1,0],[0.7, 0.7, 0.7],[0.8, 0.3, 0.2],[0.3, 0.6, 0.4],[0.3, 0.3, 0.3],[0.5, 0.5, 0.9],[0.9, 0.9, 0.6],[0.5, 0.5, 0.5],[0.7, 0.9, 0.7],[0.4, 0.9, 0.4],[0.9, 0.5, 0.6],[0.7, 0.2, 0.2],[0.3, 0.4, 0.5]		]

spacereg = re.compile(r" +")
slashreg = re.compile(r"/")

def locate(pattern, root=os.curdir):
    '''Locate all files matching supplied filename pattern in and below
    supplied root directory.'''
    for path, dirs, files in os.walk(os.path.abspath(root)):
        for filename in fnmatch.filter(files, pattern):
            yield os.path.join(path, filename)

def parseCommandLine():
    parser = OptionParser()
    parser.add_option("-p", "--path", dest="path", help="path to obj files",  default=".", type="string")
    parser.add_option("-c", "--color", dest="color", help="set a specific color", default=[], nargs=3, type="float")
    parser.add_option("--js", dest="JsOutput", help="enable output of .js file", default=0)

    (options, args) = parser.parse_args()
    return options
