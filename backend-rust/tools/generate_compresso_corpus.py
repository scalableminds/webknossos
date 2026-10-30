from pathlib import Path
import argparse, json, subprocess
import numpy as np,compresso
parser = argparse.ArgumentParser(description="Generate Compresso 3.2.2 fixtures and compare native/Rust decoders.")
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--native-decoder", type=Path, required=True)
parser.add_argument("--rust-decoder", type=Path, required=True)
args = parser.parse_args()
out=args.output;out.mkdir(exist_ok=True)
rng=np.random.default_rng(9137);cases=[]
shapes=[(1,1,1),(9,7,3),(33,19,7),(127,1,2),(128,1,2),(128,256,1)]
for width in [1,2,4,8]:
 for shape in shapes:
  x,y,z=np.indices(shape)
  maxid=(1<<(8*width))-1
  patterns={
   'zero':np.zeros(shape,dtype=f'u{width}'),
   'constant':np.full(shape,maxid,dtype=f'u{width}'),
   'regions':((x//3+7*(y//2)+19*(z%3))%29).astype(f'u{width}'),
   'checker':((x+y+z)%2).astype(f'u{width}'),
   'random':rng.integers(0,32,size=shape,dtype=f'u{width}'),
  }
  patterns['random'].flat[0]=maxid
  for pattern,data in patterns.items():
   for version,connectivity in [(0,4),(0,6),(1,4)]:
    for steps in [(2,2,1),(4,2,1),(4,4,1),(8,4,1),(8,8,1)]:
     # Large threshold case need only one representative, other cases cover all windows.
     if shape==(128,256,1) and (pattern!='regions' or steps!=(4,4,1)):continue
     name=f'u{width}_{shape[0]}x{shape[1]}x{shape[2]}_{pattern}_v{version}_c{connectivity}_s{steps[0]}x{steps[1]}'
     encoded=compresso.compress(data,steps=steps,connectivity=connectivity,random_access_z_index=bool(version))
     p=out/(name+'.cpso');p.write_bytes(encoded)
     expected=data.astype(f'<u{width}').tobytes(order='F');(out/(name+'.raw')).write_bytes(expected)
     actual=out/(name+'.native');r=subprocess.run([str(args.native_decoder),str(p),str(actual)],capture_output=True)
     if r.returncode:raise RuntimeError((name,r.returncode,r.stderr.decode()))
     if actual.read_bytes()!=expected:raise RuntimeError('JNI header decoder disagrees with encoder: '+name)
     rust=out/(name+'.rust');r=subprocess.run([str(args.rust_decoder),str(p),str(rust)],capture_output=True)
     match=r.returncode==0 and rust.read_bytes()==expected
     cases.append(dict(name=name,width=width,shape=shape,steps=steps,connectivity=connectivity,version=encoded[4],size=len(encoded),match=match,error=r.stderr.decode()))
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
print('cases',len(cases),'Rust failures',sum(not c['match'] for c in cases))
for c in cases:
 if not c['match']:print(c['name'],c['error'])
