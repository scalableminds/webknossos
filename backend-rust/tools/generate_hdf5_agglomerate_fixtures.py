"""Independent agglomerate fixtures and real-file oracles: h5py3.15.1/numpy2.3.4.
uv run --offline --cache-dir /tmp/wk-rust-reader-uv --with h5py==3.15.1 --with numpy==2.3.4 python backend-rust/tools/generate_hdf5_agglomerate_fixtures.py
"""
from pathlib import Path
import json
import shutil
import h5py
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'backend-rust/datastore/tests/fixtures/agglomerates'
OUT.mkdir(parents=True,exist_ok=True)
arrays={
    'segment_to_agglomerate':([0,1,1,1,2,2],'u8'),
    'agglomerate_to_segments_offsets':([0,0,3,5],'u8'),
    'agglomerate_to_segments':([1,2,3,4,5],'u4'),
    'agglomerate_to_positions':([[10,0,0],[11,0,0],[12,0,0],[20,0,0],[21,0,0]],'i4'),
    'agglomerate_to_edges_offsets':([0,0,2,3],'u8'),
    'agglomerate_to_edges':([[0,1],[1,2],[0,1]],'u4'),
    'agglomerate_to_affinities':([0.5,0.25,1.0],'f4'),
}
for name,version,endian,filtered in [('contiguous','earliest','<',False),('chunked_v1','earliest','>',True),('chunked_v4','latest','>',True),('remapped','earliest','<',False)]:
    with h5py.File(OUT/f'{name}.hdf5','w',libver=version) as f:
        for key,(data,dtype) in arrays.items():
            if name=='remapped' and key=='segment_to_agglomerate':data=[0,7,7,7,8,8]
            if name=='remapped' and key=='agglomerate_to_positions':data=[[110,0,0],[111,0,0],[112,0,0],[120,0,0],[121,0,0]]
            values=np.array(data,dtype=endian+dtype)
            options=dict(chunks=True,compression='gzip',shuffle=True,fletcher32=True) if filtered else {}
            f.create_dataset(key,data=values,**options)
        for size in [1,2,4,8]:
            f.create_dataset(f'signed_{size}',data=np.array([-1,0,1,np.iinfo(f'i{size}').min,np.iinfo(f'i{size}').max],dtype=endian+f'i{size}'))
            f.create_dataset(f'unsigned_{size}',data=np.array([0,1,np.iinfo(f'u{size}').max],dtype=endian+f'u{size}'))
        f.create_dataset('float64',data=np.array([0.1,1.5,-2.25],dtype=endian+'f8'))
        f.create_dataset('float32',data=np.array([0.1,1.5,-2.25],dtype=endian+'f4'))
for name,path in [
    ('real_70',ROOT/'binaryData/sample_organization/test-agglomerate-file/segmentation/agglomerates/agglomerate_view_70.hdf5'),
    ('real_100',ROOT/'binaryData/sample_organization/Sample_e2006_wkw_with_reconstructed_neurons2/segmentation/agglomerates/agglomerate_view_100.hdf5')]:
    shutil.copyfile(path,OUT/f'{name}.hdf5')
    with h5py.File(path) as f:
        offsets=f['agglomerate_to_segments_offsets'][:]
        edge_offsets=f['agglomerate_to_edges_offsets'][:]
        queries=[]
        ids=np.linspace(0,len(offsets)-2,min(8,len(offsets)-1),dtype=int)
        for i in ids:
            start,end=map(int,offsets[i:i+2]);es,ee=map(int,edge_offsets[i:i+2])
            segments=[str(int(v)) for v in f['agglomerate_to_segments'][start:end]]
            positions=f['agglomerate_to_positions'][start:end].astype(np.uint64).astype(np.int32).tolist()
            edges=[[segments[int(a)],segments[int(b)]] for a,b in f['agglomerate_to_edges'][es:ee]]
            affinities=f['agglomerate_to_affinities'][es:ee].astype(np.float32).tolist()
            queries.append(dict(id=int(i),segments=segments,positions=positions,edges=edges,affinities=affinities))
        mapping=[str(int(v)) for v in f['segment_to_agglomerate'][:]]
        (OUT/f'{name}_oracle.json').write_text(json.dumps(dict(largest_id=len(offsets)-1,mapping=mapping,queries=queries),separators=(',',':'))+'\n')
