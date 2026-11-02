"""Run the complete production vertex shader on actual GLB samples with transform feedback.
Usage: python tools/check-cloth-shader.py SHADERS_JSON FIXTURE_JSON OUTPUT_JSON
The fixture comes from check-controlled-cloth.mjs; includes independent numeric normal derivatives.
"""
import json,sys,hashlib
from pathlib import Path
import numpy as np
import moderngl
shaders=json.loads(Path(sys.argv[1]).read_text());fixture=json.loads(Path(sys.argv[2]).read_text())
ctx=moderngl.create_standalone_context(backend='egl',require=330)
fbo=ctx.simple_framebuffer((1,1));fbo.use()
program=ctx.program(vertex_shader=shaders['garment']['vertex'],varyings=['gl_Position','vFabricPoint','vFabricNormal','vMapUv'])
for name in ['modelMatrix','modelViewMatrix','projectionMatrix']:program[name].write(np.eye(4,dtype='f4').tobytes())
program['mapTransform'].write(np.eye(3,dtype='f4').tobytes())
samples=np.array(fixture['samples'],dtype='f4')
vertices=ctx.buffer(samples.tobytes());output=ctx.buffer(reserve=len(samples)*11*4)
vao=ctx.vertex_array(program,[(vertices,'3f 3f 2f 1f','position','normal','uv','garmentSurface')])
checks=[]
for test in fixture['states']:
 bx,bz,twist=test['state'];program['clothBend'].value=(bx,bz);program['clothTwist'].value=twist
 vao.transform(output,vertices=len(samples))
 actual=np.frombuffer(output.read(),dtype='f4').reshape(-1,11);expected=np.array(test['expected'])
 position=float(np.abs(actual[:,:4]-expected[:,:4]).max());normal=float(np.abs(actual[:,6:9]-expected[:,6:9]).max())
 rest=float(np.abs(actual[:,4:6]-samples[:,:2]).max());uv=float(np.abs(actual[:,9:11]-samples[:,6:8]).max())
 assert position<.0002,(position,test['state']);assert normal<.0001,(normal,test['state']);assert rest==0 and uv==0,(rest,uv)
 pinned=(samples[:,1]>=-130)|(samples[:,8]>=2.5)
 assert np.allclose(actual[pinned,:3],samples[pinned,:3],rtol=0,atol=.0001)
 checks.append({'state':test['state'],'vertices':len(samples),'maxPositionError':position,'maxNormalError':normal,'restPrintCoordinatesUnchanged':True,'uvUnchanged':True,'supportAndHangerPinned':True})
result={'scope':'Full production garment vertex GLSL under EGL transform feedback. Actual GLB samples; CPU warp and numeric normal derivative comparison; not a browser FPS test.','shaderSha256':hashlib.sha256(shaders['garment']['vertex'].encode()).hexdigest(),'checks':checks}
Path(sys.argv[3]).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
