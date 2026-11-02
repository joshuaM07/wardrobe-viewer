"""Render both sides of a printed fabric triangle with the production GLSL."""
import sys,json
from pathlib import Path
import numpy as np
import moderngl

shaders=json.loads(Path(sys.argv[1]).read_text())
ctx=moderngl.create_standalone_context(backend='egl',require=330)
p=ctx.program(vertex_shader=shaders['garment']['vertex'],fragment_shader=shaders['garment']['fragment'])
for name in ['modelMatrix','modelViewMatrix','projectionMatrix']:p[name].write(np.eye(4,dtype='f4').tobytes())
p['mapTransform'].write(np.eye(3,dtype='f4').tobytes())
white=ctx.texture((1,1),4,bytes([255,255,255,255]),internal_format=0x8c43)
pink=ctx.texture((1,1),4,bytes([255,0,255,255]),internal_format=0x8c43)
for name,slot in [('map',0),('backMap',1),('fabricMap',2),('fabricBackMap',3),('printMask',4),('frontArtwork',5),('backArtwork',6)]:p[name].value=slot;white.use(slot)
pink.use(5)
for name,value in [('diffuse',(1,1,1)),('opacity',1),('fabricColor',(1,1,1)),('woodColor',(.2,.1,.05)),('customized',1),('keepOriginal',0),('frontEnabled',1),('backEnabled',0),('frontPlacement',(0,-405,4,4)),('backPlacement',(0,-405,4,4))]:p[name].value=value
data=np.array([[-.9,-.9,0,0,0,1,.25,.5,0],[.9,-.9,0,0,0,1,.25,.5,0],[0,.9,0,0,0,1,.25,.5,0]],dtype='f4')
v=ctx.buffer(data.tobytes());target=ctx.simple_framebuffer((16,16),components=4);target.use()
def render(indices):
    i=ctx.buffer(np.array(indices,dtype='u4').tobytes());vao=ctx.vertex_array(p,[(v,'3f 3f 2f 1f','position','normal','uv','garmentSurface')],i,index_element_size=4)
    target.clear();vao.render();pixel=np.frombuffer(target.read(components=4),dtype='u1').reshape(16,16,4)[6,8].tolist();vao.release();i.release();return pixel
front=render([0,1,2]);inside=render([0,2,1])
assert front[0]>front[1]+80 and front[2]>front[1]+80,front
assert max(inside[:3])-min(inside[:3])<3 and inside[3]==255,inside
print(json.dumps({'scope':'Production fragment shader pixels under EGL','exteriorArtwork':front,'interiorFabric':inside,'artworkDoesNotShowInside':True}))
