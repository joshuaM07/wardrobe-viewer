"""Offline cloth bake. Run with blender --background --python thisfile -- INPUT OUTPUT.
The browser consumes bounded native vertex poses, never this solver.
"""
import bpy,json,sys,time,math
from pathlib import Path
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];source=Path(args[0]);out=Path(args[1]);out.mkdir(parents=True,exist_ok=True)
d=json.loads(source.read_text());bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.gravity=(0,-9810,0);scene.unit_settings.scale_length=.001;scene.render.fps=60;scene.frame_start=1;scene.frame_end=420
mesh=bpy.data.meshes.new('sewn garment');mesh.from_pydata(d['vertices'],d['sew'],d['faces']);mesh.update();obj=bpy.data.objects.new('garment',mesh);bpy.context.collection.objects.link(obj);bpy.context.view_layer.objects.active=obj;obj.select_set(True)
pin=obj.vertex_groups.new(name='shoulder contact');pin.add(d['pins'],1.,'REPLACE')
curve=bpy.data.curves.new('hanger support','CURVE');curve.dimensions='3D';curve.bevel_depth=4.5;curve.bevel_resolution=2;poly=curve.splines.new('POLY');poly.points.add(len(d['hanger'])-1)
for p,v in zip(poly.points,d['hanger']):p.co=(v[0],v[1]-3,v[2],1)
hanger=bpy.data.objects.new('hanger',curve);bpy.context.collection.objects.link(hanger);bpy.context.view_layer.objects.active=hanger;obj.select_set(False);hanger.select_set(True);bpy.ops.object.convert(target='MESH');hanger=bpy.context.object;hanger.modifiers.new('contact','COLLISION');hanger.collision.thickness_outer=1;hanger.collision.thickness_inner=1
bpy.context.view_layer.objects.active=obj;hanger.select_set(False);obj.select_set(True)
# The armature moves only the pin goals before the cloth modifier. Free
# vertices keep their simulated world inertia; export returns to hanger space.
armdata=bpy.data.armatures.new('hanger driver');arm=bpy.data.objects.new('hanger driver',armdata);bpy.context.collection.objects.link(arm)
obj.select_set(False);arm.select_set(True);bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode='EDIT')
bone=armdata.edit_bones.new('support');bone.head=(0,0,0);bone.tail=(0,100,0);bpy.ops.object.mode_set(mode='OBJECT')
arm.select_set(False);obj.select_set(True);bpy.context.view_layer.objects.active=obj
weights=obj.vertex_groups.new(name='support');weights.add(list(range(len(d['vertices']))),1.,'REPLACE')
driver=obj.modifiers.new('moving hanger','ARMATURE');driver.object=arm
pose=arm.pose.bones['support'];pose.rotation_mode='XYZ'
mod=obj.modifiers.new('gravity drape','CLOTH');s=mod.settings;s.quality=int(args[2]) if len(args)>2 else 12;s.mass=.001*({'tee':1.,'long-sleeve':1.15,'crewneck':1.6,'hoodie':2.}[d['garment']['type']]);s.air_damping=.05;s.tension_stiffness=10000;s.compression_stiffness=10000;s.shear_stiffness=8000;s.bending_stiffness={'tee':.02,'long-sleeve':.04,'crewneck':.12,'hoodie':.18}[d['garment']['type']];s.tension_damping=.1;s.compression_damping=.1;s.shear_damping=.1;s.bending_damping=.001;s.vertex_group_mass=pin.name;s.pin_stiffness=1.;s.use_sewing_springs=False;s.sewing_force_max=10.;s.use_pressure=False
c=mod.collision_settings;c.use_collision=True;c.distance_min=1;c.collision_quality=4;c.use_self_collision=True;c.self_distance_min=1;c.self_friction=5
contact=obj.vertex_groups.new(name='interior self-contact');contact.add(d['selfExcluded'],1.,'REPLACE');c.vertex_group_self_collisions=contact.name
mod.point_cache.frame_start=1;mod.point_cache.frame_end=420
started=time.time()
for frame in range(1,421):
 t=max(0.,min(1.,(frame-30)/45));theta=math.radians(30)*t*t*(3-2*t)
 if frame>105:
  t=max(0.,min(1.,(frame-105)/45));theta=math.radians(30)*(1-t*t*(3-2*t))
 amount=0.
 if frame>240:
  t=max(0.,min(1.,(frame-240)/45));amount=60*t*t*(3-2*t)
  if frame>315:
   t=max(0.,min(1.,(frame-315)/45));amount=60*(1-t*t*(3-2*t))
 pose.rotation_euler.y=theta;hanger.rotation_euler.y=theta;pose.location.x=amount;hanger.location.x=amount
 scene.frame_set(frame);ev=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh();positions=[[v.co.x,v.co.y,v.co.z] for v in m.vertices];ev.to_mesh_clear()
 import numpy as np
 np.save(out/(str(frame)+'.npy'),np.array(positions,dtype='float32'))
 (out/(str(frame)+'-angle.json')).write_text(json.dumps(theta));(out/(str(frame)+'-translation.json')).write_text(json.dumps(amount))
 if frame in [1,30,60,75,105,135,150,240,270,285,315,345,360,420]:
  (out/(str(frame)+'.json')).write_text(json.dumps(positions));print('FRAME',frame,'seconds',round(time.time()-started,2),flush=True)

# Compact, portable cache for the asset packager; all coordinates stay in mm.
def local(frame):
 a=np.load(out/(str(frame)+'.npy'));theta=json.loads((out/(str(frame)+'-angle.json')).read_text());c,s=math.cos(theta),math.sin(theta);a=a@np.array([[c,0,s],[0,1,0],[-s,0,c]]);a[:,0]-=json.loads((out/(str(frame)+'-translation.json')).read_text());return a
rest=local(240)
np.savez_compressed(out/'bake.npz',rest=rest,turnPositive=local(60)-rest,turnNegative=local(135)-rest,railPositive=local(270)-rest,railNegative=local(345)-rest)
(out/'protocol.json').write_text(json.dumps({'blender':bpy.app.version_string,'template':d['garment']['id'],'units':'millimeters','steps':420,'drive':'30-degree turn, return and60-mm rail translation','runtimeSolver':False,'bend':mod.settings.bending_stiffness},indent=2))
