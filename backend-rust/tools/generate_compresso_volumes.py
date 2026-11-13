from pathlib import Path
import argparse, tempfile
import numpy as np,compresso,json,struct,gzip,subprocess
parser = argparse.ArgumentParser(description="Generate full/edge/missing Compresso fragments and sharded volumes.")
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--native-decoder", type=Path, required=True)
args = parser.parse_args()
out=args.output;out.mkdir(parents=True,exist_ok=True)
scratch = tempfile.TemporaryDirectory(prefix="wk-compresso-volumes-")
shape=(7,5,3);chunks=(4,3,2);offset=(5,7,11)
x,y,z=np.indices(shape)
for width in [1,2,4,8]:
 original=np.asarray(1+x+13*y+73*z,dtype=f'u{width}',order='F');original.flat[0]=(1<<(8*width))-1
 for mode in ['plain','shard_raw','shard_gzip']:
  directory=out/f'u{width}_{mode}';scale=directory/'1';scale.mkdir(parents=True,exist_ok=True)
  meta=dict(key='1',size=shape,resolution=[1,1,1],chunk_sizes=[chunks],encoding='compresso',voxel_offset=offset)
  if mode!='plain':meta['sharding']={'@type':'neuroglancer_uint64_sharded_v1','preshift_bits':0,'hash':'identity','minishard_bits':0,'shard_bits':0,'minishard_index_encoding':'gzip' if mode.endswith('gzip') else 'raw','data_encoding':'gzip' if mode.endswith('gzip') else 'raw'}
  (directory/'info').write_text(json.dumps(dict(type='segmentation',data_type=f'uint{width*8}',num_channels=1,scales=[meta]))+'\n')
  entries=[];expected=original.copy(order='F')
  for pos in np.ndindex((2,2,2)):
   begin=tuple(i*c for i,c in zip(pos,chunks));end=tuple(min(b+c,n)for b,c,n in zip(begin,chunks,shape));slices=tuple(slice(a,b)for a,b in zip(begin,end))
   if pos==(1,1,1):expected[slices]=0;continue
   data=np.asfortranarray(original[slices]);encoded=compresso.compress(data,steps=(4,4,1),connectivity=4,random_access_z_index=bool(sum(pos)%2))
   # Cross-check every full/edge fragment with the actual repository native decoder.
   tmp=Path(scratch.name)/'fragment.cpso';tmp.write_bytes(encoded);raw=tmp.with_suffix('.raw');r=subprocess.run([str(args.native_decoder),str(tmp),str(raw)],check=True)
   assert raw.read_bytes()==data.astype(f'<u{width}').tobytes(order='F')
   if mode=='plain':(scale/'_'.join(f'{a+o}-{b+o}'for a,b,o in zip(begin,end,offset))).write_bytes(encoded)
   else:
    code=pos[0]+2*pos[1]+4*pos[2];payload=gzip.compress(encoded,mtime=0) if mode.endswith('gzip') else encoded;entries.append((code,payload))
  if mode!='plain':
   body=bytearray();stored=[]
   for code,payload in sorted(entries,reverse=True):
    body.extend(b'PAD');start=len(body);body.extend(payload);stored.append((code,start,len(payload)))
   ids=[];deltas=[];sizes=[];last_id=0;last_end=0
   for code,start,size in sorted(stored):ids.append(code-last_id);deltas.append((start-last_end)%(2**64));sizes.append(size);last_id=code;last_end=start+size
   index=b''.join(struct.pack('<Q',i)for row in [ids,deltas,sizes]for i in row)
   if mode.endswith('gzip'):index=gzip.compress(index,mtime=0)
   start=len(body);body.extend(index);(scale/'0.shard').write_bytes(struct.pack('<2Q',start,len(body))+body)
  (directory/'expected_full.raw').write_bytes(expected.astype(f'<u{width}').tobytes(order='F'))
  (directory/'expected_crop.raw').write_bytes(expected[1:7,1:5,1:3].astype(f'<u{width}').tobytes(order='F'))
print('12 valid Compresso volumes with offsets/edge/missing/sharding/gzip')
