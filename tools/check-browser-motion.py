# Requires Python Playwright and its Chromium browser. Run against a production export.
import json, sys
from pathlib import Path

base=sys.argv[1] if len(sys.argv)>1 else "http://localhost:3001"
output=Path(sys.argv[2] if len(sys.argv)>2 else "/tmp/wardrobe-browser-qa")
output.mkdir(parents=True,exist_ok=True)
from playwright.sync_api import sync_playwright
results={'scope':'Chromium using SwiftShader software WebGL; interaction verification only, not hardware FPS','checks':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=browser.new_page(viewport={'width':1000,'height':760})
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/?product=6',wait_until='networkidle')
 page.wait_for_function("!document.querySelector('.wardrobe').classList.contains('is-loading')",timeout=60000)
 assert page.locator('.renderer-note').count()==0
 page.wait_for_timeout(3000)
 results['checks'].append('WebGL renders')
 def stats(): return json.loads(page.locator('canvas').get_attribute('data-performance'))
 def drag(x0,x1):
  box=page.locator('canvas').bounding_box();y=box['y']+box['height']*.44
  page.mouse.move(x0,y);page.mouse.down()
  for i in range(1,9):
   page.mouse.move(x0+(x1-x0)*i/8,y);page.wait_for_timeout(12)
  page.mouse.up()
 print('Product ready:',stats(),flush=True)
 start=stats()['rotationRad']
 drag(470,650)
 page.wait_for_timeout(150)
 first=stats()
 page.wait_for_timeout(900)
 last=stats()
 assert last['rotationRad']>start+.5,(start,first,last)
 assert page.locator('.wardrobe.is-product').count()==1
 assert last['drawCalls']==3,last
 results['desktopDrag']=last
 results['checks'].append('Mouse drag rotates and releases with momentum')
 page.get_by_role('button',name='FRONT',exact=True).click()
 page.wait_for_timeout(1600)
 assert abs(stats()['rotationRad']/(2*3.141592653589793)-round(stats()['rotationRad']/(2*3.141592653589793)))<.01,stats()
 results['checks'].append('Front button stops momentum and returns to the nearest front orientation')
 page.get_by_role('button',name='Next garment',exact=True).click()
 page.get_by_role('button',name='Next garment',exact=True).click()
 page.get_by_role('button',name='Previous garment',exact=True).click()
 page.wait_for_timeout(1800)
 assert page.locator('.product-caption h1').inner_text()=='Made This Studio Tee'
 results['checks'].append('Rapid previous/next changes settle on the requested piece')
 page.screenshot(path=str(output/'desktop.png'))
 results['desktop']=stats()
 page.get_by_role('button',name='CLOSE',exact=True).click()
 page.wait_for_timeout(1600)
 assert page.locator('.wardrobe.is-product').count()==0
 assert page.locator('.hover-label').count()==0,'closing must release desktop rack focus'
 results['checks'].append('Viewer returns to rack')
 # Acquire a displaced neighbor near its edge, then keep the pointer there
 # through its whole turn. Small real pointer movements must not restart it.
 page.mouse.move(10,10)
 page.locator('.garment-accessibility button').nth(3).focus()
 page.wait_for_timeout(2200)
 expected=page.locator('.garment-accessibility button').nth(4).inner_text()
 box=page.locator('canvas').bounding_box()
 x=box['x']+box['width']*610/1151;y=box['y']+box['height']*270/640
 for n in range(24):
  page.mouse.move(x+(.2 if n%2 else 0),y)
  page.wait_for_timeout(50)
  assert page.locator('.hover-label').inner_text()==expected,'animation must not change hover ownership'
 page.mouse.click(x,y)
 assert page.locator('.product-caption h1').inner_text()==expected,'click must open the hovered piece during its turn'
 results['checks'].append('Displaced neighbor retains hover through its turn and opens the same garment')
 # Actual mobile touch events through Chromium, including generated clicks.
 mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
 page=mobile.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base,wait_until='networkidle')
 page.wait_for_function("!document.querySelector('.wardrobe').classList.contains('is-loading')",timeout=60000)
 page.wait_for_timeout(2500)
 slider=page.get_by_role('slider',name='Rack position')
 before=float(slider.input_value())
 cdp=mobile.new_cdp_session(page)
 box=page.locator('canvas').bounding_box();y=box['y']+box['height']*.5
 cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':280,'y':y}]})
 for x in [260,235,210,185,160,135]:
  cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y}]});page.wait_for_timeout(20)
 cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
 page.wait_for_timeout(1800)
 after=float(slider.input_value())
 assert after>before,(before,after)
 assert page.locator('.wardrobe.is-product').count()==0,'swipe must not click open a garment'
 results['checks'].append('Mobile swipe carries along the rack and suppresses the synthetic click')
 page.get_by_role('button',name='SEE AVAILABILITY',exact=True).click()
 page.wait_for_timeout(2400)
 assert page.locator('.wardrobe.is-product').count()==1
 box=page.locator('canvas').bounding_box();y=box['y']+box['height']*.45
 cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':140,'y':y}]})
 for x in [160,185,210,235,260]:
  cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y}]});page.wait_for_timeout(20)
 cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
 page.wait_for_timeout(1400)
 assert abs(stats()['rotationRad'])>.5,stats()
 results['checks'].append('Touch product drag rotates with momentum')
 page.screenshot(path=str(output/'mobile.png'))
 results['mobile']=stats()
 page.emulate_media(reduced_motion='reduce')
 page.get_by_role('button',name='FRONT',exact=True).click();page.wait_for_timeout(200)
 assert stats()['coasting']==False
 results['checks'].append('Reduced motion cancels momentum')
 assert not errors,errors
 results['pageErrors']=errors
 browser.close()
print(json.dumps(results,indent=2))
(output/'results.json').write_text(json.dumps(results,indent=2)+'\n')
