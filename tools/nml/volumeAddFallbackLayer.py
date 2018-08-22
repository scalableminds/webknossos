import sys
import zipfile
import xml.etree.ElementTree as ET
import xml.dom.minidom
import os

# Adds the fallback layer attribute to a volume tracing zip (sets it to layer "segmentation")

def main():
    if len(sys.argv) != 2 or not sys.argv[1].lower().endswith('.zip'):
        printUsage()
        sys.exit(1)

    inputFilename = os.path.abspath(sys.argv[1])
    outputFilename = os.path.splitext(inputFilename)[0] + '-withFallbackLayer' + os.path.splitext(inputFilename)[1]

    nmlFilename = ''
    nmlContent = ''

    with zipfile.ZipFile(inputFilename, 'r') as infile:
        with zipfile.ZipFile(outputFilename, 'w') as outfile:
            outfile.comment = infile.comment
            for item in infile.infolist():
                if not item.filename.lower().endswith('.nml'):
                    outfile.writestr(item, infile.read(item.filename))
                else:
                    nmlFilename = item.filename
                    nmlContent = infile.read(item.filename).decode('utf-8')

    nml = ET.fromstring(nmlContent)
    volume = nml.find('volume')
    volume.set('fallbackLayer', 'segmentation')

    with zipfile.ZipFile(outputFilename, mode='a', compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(nmlFilename, ET.tostring(nml))

    print('wrote', outputFilename)


def printUsage():
    print('usage: python3 addFallbackLayer.py myVolumeTracing.zip')

if __name__ == '__main__':
    main()
