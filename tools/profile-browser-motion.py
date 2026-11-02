"""Measure actual rendered RAF delivery during the reference replay, using wall-clock time.
Usage: python tools/profile-browser-motion.py URL OUTPUT_JSON
Chromium/SwiftShader is software-rendered; this does not predict hardware FPS.
Run comparisons sequentially on the same otherwise idle machine.
"""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
base=sys.argv[1];output=Path(sys.argv[2]);output.parent.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1000,'height':760},device_scale_factor=1)
 page.add_init_script('''(() => {
 const nativeRAF=window.requestAnimationFrame.bind(window);
 let context=null,chain=0,lastTime=-1;const steps=new Map();
 window.__renderedFrames=[];
 window.requestAnimationFrame=callback=>{
  const id=context?context.chain:++chain;
  return nativeRAF(time=>{const previous=context,step=(steps.get(id)||0)+1;steps.set(id,step);context={chain:id,time,step};try{callback(time);}finally{context=previous;}});
 };
 for(const proto of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
  for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){
   if(!Object.hasOwn(proto,name))continue;
   const original=proto[name];proto[name]=function(...args){
    if(context&&this.canvas.matches('.rack-canvas')&&context.time!==lastTime){
     window.__renderedFrames.push({...context,width:this.canvas.width,height:this.canvas.height});lastTime=context.time;
    }
    return original.apply(this,args);
   };
  }
 }
 })();''')
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/?tools',wait_until='networkidle');page.wait_for_selector('.wardrobe:not(.is-loading)',timeout=60000)
 assert page.locator('.renderer-note').count()==0
 page.wait_for_timeout(2500)
 page.evaluate('window.__renderedFrames=[]')
 page.get_by_role('button',name='Replay motion',exact=True).click()
 page.wait_for_timeout(20000)
 frames=page.evaluate('window.__renderedFrames')
 intervals=[b['time']-a['time'] for a,b in zip(frames,frames[1:]) if a['chain']==b['chain'] and b['step']==a['step']+1]
 assert len(intervals)>20,'Insufficient rendering samples'
 intervals.sort()
 result={'scope':'Native wall-clock Chromium SwiftShader replay. RAF delivery for consecutive rendered frames in the same animation chain; intentional demand-renderer idle periods excluded. No controlled animation clock; not hardware FPS.',
  'viewport':[1000,760],'samples':len(intervals),'intervalMsP50':round(intervals[int(len(intervals)*.5)],3),'intervalMsP95':round(intervals[int(len(intervals)*.95)],3),
  'framesOver33ms':sum(t>33.4 for t in intervals),'renderer':json.loads(page.locator('canvas').get_attribute('data-performance')),'pageErrors':errors,'renderedFrames':frames}
 assert not errors,errors
 output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='renderedFrames'}),flush=True)
 browser.close()
