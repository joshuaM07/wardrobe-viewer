"""Record the actual viewer through hover, opening, full turns and reversal.

All simulation frames are retained at a controlled60Hz; not hardware FPS.
"""
import sys,json,base64,io,subprocess,time
from pathlib import Path
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
base=sys.argv[1];out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1000,'height':760},device_scale_factor=1)
 page.add_init_script('''(()=>{const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,options){return getContext.call(this,type,type.startsWith('webgl')?{...options,preserveDrawingBuffer:true}:options)};let now=0,id=0,pending=new Map();Object.defineProperty(performance,'now',{value:()=>now});window.requestAnimationFrame=f=>{pending.set(++id,f);return id};window.cancelAnimationFrame=i=>pending.delete(i);const output=document.createElement('canvas');output.width=640;output.height=810;const ctx=output.getContext('2d');window.__clothQA={get time(){return now},advance:t=>{now=t;const work=[...pending.values()];pending.clear();for(const f of work)f(now)},capture:()=>{const c=document.querySelector('canvas.rack-canvas');ctx.clearRect(0,0,640,810);ctx.fillStyle='#e5e5e2';ctx.fillRect(0,0,640,810);const s=Math.min(640/c.width,810/c.height),w=c.width*s,h=c.height*s;ctx.drawImage(c,(640-w)/2,(810-h)/2,w,h);return output.toDataURL('image/jpeg',.9).split(',')[1]}}})();''')
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
 page.goto(base,wait_until='networkidle')
 for _ in range(600):
  page.evaluate('window.__clothQA.advance(window.__clothQA.time+1000/60)');page.wait_for_timeout(10)
  if page.locator('.wardrobe:not(.is-loading)').count():break
 assert page.locator('.renderer-note').count()==0
 style=page.add_style_tag(content='.wardrobe{width:640px!important;height:356px!important;aspect-ratio:auto!important}')
 for _ in range(10):page.evaluate('window.__clothQA.advance(window.__clothQA.time+1000/60)')
 encoder=subprocess.Popen(['ffmpeg','-y','-loglevel','error','-f','rawvideo','-pixel_format','rgb24','-video_size','640x840','-framerate','60','-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p',str(out/'native-cloth.mp4')],stdin=subprocess.PIPE)
 records=[];milestones=[];number=0;epoch=time.time()-page.evaluate('window.__clothQA.time')/1000;cdp=page.context.new_cdp_session(page)
 def frame(label,snapshot=False):
  global number
  captured=page.evaluate('''()=>{window.__clothQA.advance(window.__clothQA.time+1000/60);return {image:window.__clothQA.capture(),stats:JSON.parse(document.querySelector('canvas.rack-canvas').dataset.performance||'{}')}}''')
  im=Image.open(io.BytesIO(base64.b64decode(captured['image']))).convert('RGB');canvas=Image.new('RGB',(640,840),'#e5e5e2');canvas.paste(im,(0,30));ImageDraw.Draw(canvas).text((10,9),f'Native WebGL / controlled60Hz / {label} / {number:04d}',fill='#222');encoder.stdin.write(canvas.tobytes());records.append({'frame':number,'stage':label,'stats':captured['stats']})
  if snapshot:canvas.save(out/(label+'.jpg'),quality=94);milestones.append((label,canvas.copy()))
  number+=1
  if number%120==0:print(json.dumps({'captured':number,'stage':label}),flush=True)
 def hold(label,n):
  for i in range(n):frame(label,i==n-1)
 def event(kind,x,y,buttons):
  stamp=epoch+page.evaluate('window.__clothQA.time')/1000
  cdp.send('Input.dispatchMouseEvent',{'type':kind,'x':x,'y':y,'button':'left' if kind!='mouseMoved' else 'none','buttons':buttons,'timestamp':stamp,'clickCount':1 if kind!='mouseMoved' else 0})
 def drag(label,right=True):
  bounds=page.locator('canvas.rack-canvas').bounding_box();a=bounds['x']+bounds['width']*(.05 if right else .95);b=bounds['x']+bounds['width']*(.95 if right else .05);y=bounds['y']+bounds['height']*.45
  event('mouseMoved',a,y,0);event('mousePressed',a,y,1)
  for i in range(60):event('mouseMoved',a+(b-a)*(i+1)/60,y,1);frame(label,i in [29,59])
  event('mouseReleased',b,y,0)
 hold('rack-rest',30)
 page.locator('.garment-accessibility button').nth(6).focus();hold('hover-open',90)
 page.locator('.brand').focus();hold('hover-return',90)
 page.locator('.garment-accessibility button').nth(6).evaluate('(el)=>el.click()');hold('product-open',90)
 style.evaluate('(el)=>el.remove()');page.set_viewport_size({'width':390,'height':844});hold('mobile-front',60)
 drag('first-half-turn');hold('first-release',30);drag('full-turn');hold('second-release',30)
 drag('reverse-turn',False);hold('reverse-release',30)
 page.get_by_role('button',name='FRONT',exact=True).click();hold('front-recovery',150)
 final=json.loads(page.locator('canvas.rack-canvas').get_attribute('data-performance'));assert len(final['clothWeights'])==4 and final['morphRelative'],final;assert max(final['clothWeights'])<.001,final
 page.locator('.product-controls>.close-button').click();hold('close-to-rack',90)
 encoder.stdin.close();assert encoder.wait()==0
 assert not errors,errors
 spins=[r['stats'].get('rotationRad',0) for r in records if r['stage'] in ['full-turn','second-release']];assert max(spins)>6.2,max(spins)
 for r in records:
  weights=r['stats'].get('clothWeights',[]);assert all(0<=w<=1 for w in weights) and sum(weights)<=1.251,weights
 sheet=Image.new('RGB',(960,440*((len(milestones)+2)//3)),'#e5e5e2')
 for i,(label,im) in enumerate(milestones):im.thumbnail((320,420));sheet.paste(im,((i%3)*320,(i//3)*440))
 sheet.save(out/'native-sheet.jpg',quality=94)
 (out/'capture.json').write_text(json.dumps({'scope':'All native interaction frames at a controlled60Hz, not hardware FPS','frames':number,'pageErrors':errors,'fullTurnRadians':max(spins),'restWeights':final['clothWeights'],'frameIndex':records},indent=2)+'\n')
 print(json.dumps({'frames':number,'pageErrors':errors,'fullTurnRadians':max(spins),'restWeights':final['clothWeights']}));browser.close()
