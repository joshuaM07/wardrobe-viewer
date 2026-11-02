"""Build production GLBs from archived, physically simulated cloth poses.

The Blender solver is an offline authoring tool. Its results become bounded
native glTF morphs; the deployed viewer never runs the solver.
"""
from pathlib import Path
import argparse,json,subprocess,tempfile
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,default=root/'tools/cloth-poses');p.add_argument('--work',type=Path);args=p.parse_args()
work=args.work or Path(tempfile.mkdtemp(prefix='wardrobe-cloth-'));work.mkdir(parents=True,exist_ok=True)
garments=json.loads((root/'lib/garments.json').read_text())+[json.loads((root/'public/garments/hoodie.json').read_text())]
canonical={'tee':'flowers','long-sleeve':'world','crewneck':'republic','hoodie':'hoodie'}
def run(*cmd):subprocess.run(cmd,cwd=root,check=True)
for g in garments:
    template=canonical[g['type']];folder=work/g['id']
    run('python','tools/prepare-cloth-pattern.py',g['id'],str(folder))
    run('python','tools/build-cloth-glb.py','--input',str(folder/'input.json'),'--bake',str(args.cache/(template+'.npz')),'--canonical-input',str(args.cache/(template+'.json.gz')),'--output',str(work/'native'))
run('node','tools/optimize-garment-meshes.mjs',str(work/'native'),str(root/'public/models'),str(root/'docs/qa/three/physical-cloth-optimization.json'))
