from pathlib import Path
import argparse, struct, subprocess, json
parser = argparse.ArgumentParser(description="Record exact safe errors using the repository JNI wrapper.")
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--classes", type=Path, required=True)
parser.add_argument("--library", type=Path, required=True)
args = parser.parse_args()
root=args.output;root.mkdir(parents=True, exist_ok=True);errors=[]
prefix='An error occurred in native code: Error while decoding with compresso: '
def run(name,data,expected_error=None):
 p=root/(name+'.cpso');p.write_bytes(data);raw=root/(name+'.raw')
 r=subprocess.run(['java','--enable-native-access=ALL-UNNAMED','-cp',str(args.classes),'com.scalableminds.webknossos.datastore.compresso.GenerateCompressoFixtures',str(args.library),str(p),str(raw)],capture_output=True,text=True)
 message=r.stdout.strip()
 if expected_error is not None and message!=expected_error:raise RuntimeError((name,message,r.stderr))
 errors.append(dict(name=name,error=message,success=r.returncode==0))
def stream(locations,shape=(1,1,1)):
 return b'cpso'+bytes([0,1])+struct.pack('<3H',*shape)+bytes([1,1,1])+struct.pack('<QIQB',0,1,len(locations),4)+b'\x01'+bytes(locations)+b'\x00'
for instruction in range(6):run('error_control_'+str(instruction),stream([instruction]),prefix+str(instruction+2))
run('error_no_locations',stream([]),prefix+'1');run('literal_escape',stream([6,255]));run('literal_inline',stream([42+7]))
for n in [0,1,35]:run('error_header_'+str(n),b'\0'*n,prefix+'Expected at least 36 bytes of input for the compresso header, got '+str(n))
for name,offset,value in [('magic',0,0),('version',4,2),('width',5,3),('connectivity',35,5)]:
 data=bytearray(stream([6,255]));data[offset]=value;run('error_'+name,bytes(data),prefix+'12')
for name,offset in [('width_zero',5),('shape_zero',6)]:
 data=bytearray(stream([6,255]));data[offset]=0;run('error_'+name,bytes(data),prefix+'output length as read from header must be >0, got 0')
(root/'jni_errors.json').write_text(json.dumps(errors,indent=2)+'\n');print('JNI safe-error/literal cases:',len(errors))
