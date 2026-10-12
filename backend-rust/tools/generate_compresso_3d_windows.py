from pathlib import Path
import argparse, json, subprocess
import numpy as np,compresso
parser = argparse.ArgumentParser(description="Generate Compresso 3.2.2 fixtures and compare native/Rust decoders.")
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--native-decoder", type=Path, required=True)
parser.add_argument("--rust-decoder", type=Path, required=True)
args = parser.parse_args()
out=args.output;cases=json.loads((out/'cases.json').read_text());rng=np.random.default_rng(12291);skipped=[]
for width in [1,2,4,8]:
 for shape in [(9,7,3),(17,13,9)]:
  x,y,z=np.indices(shape);maximum=(1<<(8*width))-1
  patterns={'regions3d':((x//2+5*(y//3)+11*(z//2))%23).astype(f'u{width}'),'random3d':rng.integers(0,32,size=shape,dtype=f'u{width}')}
  patterns['random3d'].flat[0]=maximum
  for pattern,data in patterns.items():
   for version,connectivity in [(0,4),(0,6),(1,4)]:
    for steps in [(1,1,1),(1,1,8),(2,2,2),(4,4,2),(4,4,4),(8,1,8),(2,4,8)]:
     name=f'u{width}_{shape[0]}x{shape[1]}x{shape[2]}_{pattern}_v{version}_c{connectivity}_s{steps[0]}x{steps[1]}x{steps[2]}'
     try:encoded=compresso.compress(data,steps=steps,connectivity=connectivity,random_access_z_index=bool(version))
     except Exception as e:skipped.append((name,str(e)));continue
     p=out/(name+'.cpso');p.write_bytes(encoded);expected=data.astype(f'<u{width}').tobytes(order='F');(out/(name+'.raw')).write_bytes(expected)
     native=out/(name+'.native');r=subprocess.run([str(args.native_decoder),str(p),str(native)],capture_output=True)
     if r.returncode or native.read_bytes()!=expected:raise RuntimeError(('native mismatch',name,r.stderr.decode()))
     rust=out/(name+'.rust');r=subprocess.run([str(args.rust_decoder),str(p),str(rust)],capture_output=True)
     cases.append(dict(name=name,width=width,shape=shape,steps=steps,connectivity=connectivity,version=encoded[4],size=len(encoded),match=r.returncode==0 and rust.read_bytes()==expected,error=r.stderr.decode()))
(out/'cases.json').write_text(json.dumps(cases,indent=2)+'\n');(out/'encoder_rejections.json').write_text(json.dumps(skipped,indent=2)+'\n')
print('cases',len(cases),'failures',sum(not c['match'] for c in cases),'encoder rejected',len(skipped))
for c in cases:
 if not c['match']:print(c['name'],c['error'])
