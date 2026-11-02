# Capture every frame from the actual production browser renderer at a controlled clock.
# Usage: python tools/capture-continuous-motion.py URL OUTPUT REFERENCE_FRAMES [END_FRAME] [START_FRAME]
# Requires Python Playwright, Pillow, Chromium and ffmpeg. This is NOT a real-time FPS recording.
import sys,json,subprocess,io,base64
from pathlib import Path
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
base=sys.argv[1];output=Path(sys.argv[2]);reference=Path(sys.argv[3]);limit=int(sys.argv[4]) if len(sys.argv)>4 else 1136
start_frame=int(sys.argv[5]) if len(sys.argv)>5 else 0
output.mkdir(parents=True,exist_ok=True);(output/'frames').mkdir(exist_ok=True)
references=sorted(reference.glob('*.jpg'))
assert [int(p.stem) for p in references]==list(range(len(references))),'Reference indices must be contiguous from zero'
assert limit<=len(references),'Not enough source frames'

with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1000,'height':760},device_scale_factor=1)
 page.add_init_script('''(() => {
 let now=0,nextId=0,pending=new Map();
 Object.defineProperty(performance,'now',{value:()=>now});
 window.requestAnimationFrame=cb=>{const id=++nextId;pending.set(id,cb);return id;};
 window.cancelAnimationFrame=id=>pending.delete(id);
 for(const prototype of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
 for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
  if(!Object.prototype.hasOwnProperty.call(prototype,name))continue;
  const original=prototype[name];prototype[name]=function(...args){this.canvas.__qaDrawTime=now;return original.apply(this,args);};
 }
 }
 const output=document.createElement('canvas');const ctx=output.getContext('2d');
 window.__motionQA={output,ctx,get time(){return now;},advance:time=>{now=time;const callbacks=[...pending.values()];pending.clear();for(const callback of callbacks)callback(now);return callbacks.length;}};
 })();''')
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/?tools',wait_until='networkidle')
 for i in range(600):
  page.evaluate('window.__motionQA.advance(window.__motionQA.time+1000/60)');page.wait_for_timeout(10)
  if page.locator('.wardrobe:not(.is-loading)').count():break
 assert page.locator('.renderer-note').count()==0
 for i in range(5):page.evaluate('window.__motionQA.advance(window.__motionQA.time+1000/60)')
 page.add_style_tag(content='.wardrobe{width:640px!important;height:356px!important;aspect-ratio:auto!important}')
 for _ in range(4):
  page.evaluate('window.__motionQA.advance(window.__motionQA.time+1000/60)');page.wait_for_timeout(10)
 page.get_by_role('button',name='Replay motion',exact=True).evaluate('(button)=>button.click()')
 start=page.evaluate('window.__motionQA.time');box=page.locator('.wardrobe').bounding_box()
 encoder=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pixel_format','rgb24','-video_size','1280x382','-framerate','60','-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p',str(output/'comparison-60fps.mp4')],stdin=subprocess.PIPE)
 records=[]
 for n in range(start_frame):
  page.evaluate('(time)=>window.__motionQA.advance(time)',start+n*1000/60)
  if n%240==0:print(json.dumps({'simulatedPrefix':n,'startFrame':start_frame}),flush=True)
 for n in range(start_frame,limit):
  capture=page.evaluate("""(time) => {
 const callbacks=window.__motionQA.advance(time);
 const source=document.querySelector('canvas.rack-canvas');
 const {output,ctx}=window.__motionQA;
 if(output.width!==source.width||output.height!==source.height){output.width=source.width;output.height=source.height;}
 if(source.__qaDrawTime===time){ctx.fillStyle='#e5e5e2';ctx.fillRect(0,0,output.width,output.height);ctx.drawImage(source,0,0);}
 return {image:output.toDataURL('image/jpeg',.9).split(',')[1],callbacks,drawn:source.__qaDrawTime===time};
 }""",start+n*1000/60)
  captured=base64.b64decode(capture['image']);callbacks=capture['callbacks']
  (output/'frames'/f'{n:04d}.jpg').write_bytes(captured)
  a=Image.open(reference/f'{n:04d}.jpg').crop((268,272,3180,1892)).resize((640,356),Image.Resampling.LANCZOS)
  b=Image.open(io.BytesIO(captured)).resize((640,356),Image.Resampling.LANCZOS)
  pair=Image.new('RGB',(1280,382),'#e5e5e2');pair.paste(a,(0,26));pair.paste(b,(640,26));d=ImageDraw.Draw(pair);d.text((8,7),f'Reference / source frame {n:04d} / {n/60:.4f}s',fill='#222');d.text((648,7),'Actual WebGL canvas / controlled 60 Hz (UI excluded; not FPS)',fill='#222');encoder.stdin.write(pair.tobytes())
  records.append({'frame':n,'seconds':round(n/60,6),'animationCallbacks':callbacks,'drawn':capture['drawn']})
  if n%120==0:print(json.dumps({'captured':n,'total':limit}),flush=True)
 encoder.stdin.close();assert encoder.wait()==0;assert not errors,errors
 (output/'capture.json').write_text(json.dumps({'scope':'Every source frame paired with actual browser output at controlled 60 Hz; not real-time performance','frames':limit-start_frame,'startFrame':start_frame,'sourceFrames':len(references),'skippedSourceFrames':len(references)-(limit-start_frame),'frameIndex':records,'pageErrors':errors},indent=2)+'\n')
 browser.close()
