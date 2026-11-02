"""100 actual 3D pieces: desktop scrolling, native touch, GPU residency and reload.
Chromium SwiftShader checks behavior; it does not measure device GPU performance.
"""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

base=sys.argv[1]; out=Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=True)
errors=[]; checks=[]; snapshots=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 context=browser.new_context(viewport={'width':1440,'height':900},has_touch=True,device_scale_factor=1)
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 def ready():
  page.wait_for_selector('.wardrobe:not(.is-loading)',timeout=90000)
  assert page.locator('.renderer-note').count()==0
 def stats():return json.loads(page.locator('canvas.rack-canvas').get_attribute('data-performance'))
 def hydrated():
  page.wait_for_function('()=>{const s=JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance||"{}");return s.garmentMeshes===100&&s.residentDesigns>0&&s.pendingDesigns===0}',timeout=45000)
 def position(n):
  page.get_by_role('slider',name='Rack position',exact=True).fill(str(n))
  page.wait_for_timeout(1200);hydrated()
  assert page.locator('.rack-position-label').inner_text()==f'{n+1} / 100'
  assert stats()['residentDesigns']<=20,stats()
  assert stats()['textures']<100,stats()
  assert stats()['failedDesigns']==0
 def snapshot(name):
  page.screenshot(path=str(out/(name+'.png')));snapshots.append({'name':name,'stats':stats()})
 page.goto(base,wait_until='networkidle');ready()
 page.evaluate('''async()=>{
  const catalogue=await (await fetch('/garments/hoodie.json')).json();
  const sources=['flowers','world','republic','hoodie'];
  const added=[],designs={};
  for(let i=0;i<90;i++){
   const id='custom-stress-'+i,sourceId=sources[i%4];
   added.push({...catalogue,id,sourceId,name:'Personal '+i});
   const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
   x.fillStyle=`hsl(${i*47%360} 70% 45%)`;x.fillRect(0,0,256,256);
   x.fillStyle='white';x.font='bold 76px sans-serif';x.fillText(String(i),35,155);
   const art={dataUrl:c.toDataURL(),name:i+'.png',aspect:1,width:220,x:0,y:320};
   designs[id]={color:'#eee9df',originalPrint:false,front:art,...(i%3===0?{back:art}:{})};
  }
  await new Promise((resolve,reject)=>{const r=indexedDB.open('wardrobe-designs',1);r.onsuccess=()=>{
   const db=r.result,t=db.transaction('state','readwrite');t.objectStore('state').put({version:1,added,designs},'wardrobe');
   t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>reject(t.error);
  };r.onerror=()=>reject(r.error)});
 }''')
 page.reload(wait_until='networkidle');ready();hydrated()
 assert stats()['garmentMeshes']==100 and stats()['sharedMeshes']==11,stats()
 assert page.get_by_role('slider',name='Rack position',exact=True).get_attribute('max')=='99'
 checks.append('Restore 100 real 3D garments with 90 distinct designs and only 11 shared mesh assets')
 for n in [99,0,49,98,25,99]:position(n)
 assert stats()['cameraX']>29000
 snapshot('desktop-last')
 checks.append('Scrollbar reaches both ends and the middle without compressing garment slots; artwork residency stays bounded')
 # Keyboard access to the far end must move the camera, then open that piece.
 page.get_by_role('button',name='View Personal 89',exact=True).focus();page.keyboard.press('Enter')
 page.wait_for_function('()=>{const s=JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance);return s.mode==="product"&&s.garmentId==="custom-stress-89"&&s.frontArtwork}',timeout=30000)
 page.get_by_role('button',name='Next garment',exact=True).click()
 page.wait_for_function('()=>JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance).garmentId==="camo"',timeout=10000)
 page.get_by_role('button',name='Previous garment',exact=True).click()
 page.wait_for_function('()=>JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance).frontArtwork',timeout=30000)
 page.locator('.product-controls>.close-button').click();position(99)
 checks.append('Keyboard selection, product wraparound and return retain the far-end garment and artwork')
 position(49);before=float(page.get_by_role('slider',name='Rack position',exact=True).input_value())
 box=page.locator('canvas.rack-canvas').bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
 page.mouse.wheel(650,0);page.wait_for_timeout(500)
 assert float(page.get_by_role('slider',name='Rack position',exact=True).input_value())>before
 checks.append('Trackpad and mouse wheel advance the long rail')
 for width,height in [(320,568),(390,844),(844,390)]:
  page.set_viewport_size({'width':width,'height':height});position(49)
  slider=page.get_by_role('slider',name='Rack position',exact=True).bounding_box()
  assert slider and slider['width']>90 and slider['height']>=36
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
  position(99);snapshot(f'mobile-{width}x{height}')
 page.set_viewport_size({'width':390,'height':844});position(49)
 box=page.locator('canvas.rack-canvas').bounding_box();cdp=context.new_cdp_session(page)
 x=box['x']+box['width']*.75;y=box['y']+box['height']*.5
 page.evaluate("""()=>{window.rackProbe=[];window.addEventListener('pointerup',()=>{
  const record=()=>{window.rackProbe.push(Number(document.querySelector('.rack-slider').value));if(window.rackProbe.length<8)requestAnimationFrame(record)};record();
 },{once:true})}""")
 stamp=time.time()
 cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','timestamp':stamp,'touchPoints':[{'x':x,'y':y}]})
 for n,dx in enumerate([30,65,110,160]):
  cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','timestamp':stamp+(n+1)*.016,'touchPoints':[{'x':x-dx,'y':y}]})
 cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','timestamp':stamp+.080,'touchPoints':[]})
 page.wait_for_function('()=>window.rackProbe.length===8',timeout=30000)
 probe=page.evaluate('window.rackProbe');assert probe[0]>49 and max(probe)>probe[0]+.01,probe
 checks.append('Native touch swipe moves the rack and continues with damped release momentum')
 position(99);page.reload(wait_until='networkidle');ready();page.wait_for_function('()=>JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance).garmentMeshes===100');position(99)
 assert stats()['garmentMeshes']==100 and stats()['sharedMeshes']==11
 checks.append('All 100 garments and uploaded designs survive reload on mobile')
 assert not errors,errors
 browser.close()
result={'scope':'Production Chromium/SwiftShader behavior, not hardware frame rate','checks':checks,'snapshots':snapshots,'pageErrors':errors}
(out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'checks':checks,'pageErrors':errors}))
