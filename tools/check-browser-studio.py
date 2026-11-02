"""Exercise the real upload, garment switching, persistence and responsive editor.
Usage: python tools/check-browser-studio.py URL OUTPUT_DIR
Requires Playwright Chromium and Pillow. SwiftShader verifies behavior, not hardware FPS.
"""
import json,sys,re
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from playwright.sync_api import sync_playwright
base=sys.argv[1];out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',52)
for name,color,text in [('front',(226,52,157,255),'YOUR\nDESIGN'),('back',(30,155,133,255),'BACK\nPRINT')]:
 im=Image.new('RGBA',(520,600));d=ImageDraw.Draw(im);d.rounded_rectangle((70,60,450,540),radius=50,fill=color);d.multiline_text((260,200),text,font=font,anchor='ma',align='center',fill='white',spacing=20);d.ellipse((210,410,310,510),fill=(255,222,100,255));im.save(out/(name+'.png'))
result={'scope':'Real production Chromium/SwiftShader uploads, GPU-bound material state, PNG export and mobile layouts. Not hardware FPS.','checks':[],'layouts':[]};errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 context=browser.new_context(viewport={'width':1000,'height':760},accept_downloads=True)
 page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
 def ready():
  page.wait_for_selector('.wardrobe:not(.is-loading)',timeout=90000)
  assert page.locator('.renderer-note').count()==0
 def stats():return json.loads(page.locator('canvas.rack-canvas').get_attribute('data-performance'))
 def applied(kind,front=True,back=False):
  page.wait_for_function('([kind,front,back])=>{const s=JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance||"{}");return s.garmentType===kind&&s.frontArtwork===front&&s.backArtwork===back}',arg=[kind,front,back],timeout=30000)
 def create(kind='Hoodie',art=True):
  page.get_by_role('button',name=re.compile('Create your piece')).click()
  page.locator('.type-options label').filter(has_text=re.compile('^'+re.escape(kind)+'$')).click()
  if art:
   page.locator('.create-dialog input[type=file]').set_input_files(str(out/'front.png'))
   page.get_by_alt_text('Your uploaded design').wait_for()
  page.get_by_role('button',name='Create '+kind).click()
  page.wait_for_selector('.garment-studio',timeout=45000)
  page.wait_for_selector('.create-dialog',state='detached')
 page.goto(base,wait_until='networkidle');ready();create()
 applied('hoodie');piece_id=stats()['garmentId'];assert stats()['garmentMeshes']==11
 assert page.get_by_role('combobox',name='Clothing type').input_value()=='hoodie'
 result['checks'].append('Create a specified hoodie with an actual uploaded PNG on its 3D material')
 page.screenshot(path=str(out/'desktop-studio.png'))
 page.get_by_role('tab',name='Back',exact=False).click()
 page.locator('.garment-studio input[type=file]').set_input_files(str(out/'back.png'))
 page.get_by_title('back.png').wait_for();applied('hoodie',True,True)
 for kind in ['tee','long-sleeve','crewneck','hoodie']:
  page.get_by_role('combobox',name='Clothing type').select_option(kind)
  page.wait_for_function('()=>document.querySelector(".garment-studio").getAttribute("aria-busy")==="false"')
  applied(kind,True,True)
  assert stats()['garmentId']==piece_id and stats()['garmentMeshes']==11
 result['checks'].append('Switch all four garment types without losing either side or adding duplicate pieces')
 # Abort a replacement asset request: the existing garment and artwork survive.
 page.route('**/models/republic.glb*',lambda route:route.abort())
 page.get_by_role('combobox',name='Clothing type').select_option('crewneck')
 page.get_by_role('alert').filter(has_text='Could not switch').wait_for(timeout=30000)
 assert stats()['garmentType']=='hoodie' and stats()['frontArtwork'] and stats()['backArtwork']
 page.unroute('**/models/republic.glb*')
 result['checks'].append('Failed garment replacement retains the current 3D mesh and both designs')
 page.get_by_role('tab',name='Fabric colour',exact=True).click()
 page.get_by_role('textbox',name='Hex colour').fill('#263e62')
 page.wait_for_function('()=>JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance).fabricColor==="263e62"')
 page.get_by_role('tab',name='Front',exact=False).click()
 page.wait_for_function('()=>{const s=JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance);return Math.abs(Math.sin(s.rotationRad/2))<.005&&!s.coasting}')
 # Selecting an already active Front tab must also stop a free rotation.
 box=page.locator('canvas.rack-canvas').bounding_box();x=box['x']+box['width']*.4;y=box['y']+box['height']*.45
 page.mouse.move(x,y);page.mouse.down()
 for dx in [35,70,105,140]:page.mouse.move(x+dx,y);page.wait_for_timeout(15)
 page.mouse.up();page.wait_for_timeout(200)
 page.get_by_role('tab',name='Front',exact=False).click()
 page.wait_for_function('()=>{const s=JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance);return Math.abs(Math.sin(s.rotationRad/2))<.005&&!s.coasting}')
 result['checks'].append('Active print-side tab restores the matching view after drag rotation')
 before=page.locator('canvas.rack-canvas').evaluate('(el)=>[el.clientWidth,el.clientHeight]')
 with page.expect_download(timeout=45000) as info:page.get_by_role('button',name='Download PNG').click()
 info.value.save_as(str(out/'garment-export.png'))
 exported=Image.open(out/'garment-export.png').convert('RGBA');assert exported.size==(1200,1500)
 alpha=exported.getchannel('A');assert alpha.getextrema()==(0,255) and alpha.getbbox()
 import numpy as np
 pixels=np.asarray(exported);pink=(pixels[:,:,0]>150)&(pixels[:,:,1]<120)&(pixels[:,:,2]>100)&(pixels[:,:,3]>100)
 assert int(pink.sum())>1000,'export must contain the uploaded graphic'
 assert page.locator('canvas.rack-canvas').evaluate('(el)=>[el.clientWidth,el.clientHeight]')==before,'export must not resize the live preview'
 result['checks'].append('Download a nonempty 1200x1500 transparent PNG with the uploaded artwork')
 # Invalid files report errors without replacing the current print.
 page.locator('.garment-studio input[type=file]').set_input_files({'name':'bad.png','mimeType':'image/png','buffer':b'not an image'})
 page.get_by_role('alert').filter(has_text='could not be opened').wait_for()
 assert stats()['frontArtwork'] and stats()['backArtwork']
 result['checks'].append('Invalid upload preserves existing artwork and reports an actionable error')
 page.wait_for_timeout(800);page.reload(wait_until='networkidle');ready()
 page.get_by_role('button',name='View My Hoodie',exact=True).focus();page.keyboard.press('Enter')
 page.get_by_role('button',name='CUSTOMIZE',exact=True).click();applied('hoodie',True,True)
 assert stats()['garmentId']==piece_id and stats()['fabricColor']=='263e62'
 result['checks'].append('Reload restores garment type, both uploaded designs, placement and colour')
 # Reuse the same saved garment at each viewport so this tests the complete
 # mobile editor with real uploads, rather than only the catalogue shell.
 for width,height in [(320,568),(360,640),(390,844),(390,400),(768,1024),(844,390),(568,320),(1000,400),(1440,900)]:
  page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(650)
  studio=page.locator('.garment-studio');box=studio.bounding_box();canvas=page.locator('canvas.rack-canvas').bounding_box()
  assert box and box['width']>200 and box['height']>140,(width,height,box)
  assert box['x']>=-1 and box['y']>=-1 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,(width,height,box)
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(width,height,'page overflow')
  assert page.locator('.studio-scroll').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),(width,height,'editor overflow')
  assert canvas['height']>80 and canvas['width']>160
  # Upload, select, sliders and download must be reachable by scrolling.
  for control in [page.get_by_role('combobox',name='Clothing type'),page.get_by_role('button',name='Upload front artwork') if not stats()['frontArtwork'] else page.get_by_role('button',name='Replace artwork'),page.get_by_role('button',name='Download PNG')]:
   control.scroll_into_view_if_needed();bounds=control.bounding_box();assert bounds['height']>=40,(width,height,bounds)
  page.get_by_role('combobox',name='Clothing type').scroll_into_view_if_needed()
  page.screenshot(path=str(out/f'studio-{width}x{height}.png'))
  result['layouts'].append({'viewport':[width,height],'editor':box,'preview':canvas,'mobile':stats()['mobile']})
 result['checks'].append('Editor and live preview fit small phones, tablets, landscape phones and desktop; all primary controls remain reachable')
 # Native touch input also reaches creation, type switching and artwork upload.
 touch=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
 mobile=touch.new_page();mobile.on('pageerror',lambda error:errors.append(str(error)));mobile.goto(base,wait_until='networkidle');mobile.wait_for_selector('.wardrobe:not(.is-loading)',timeout=90000)
 mobile.get_by_role('button',name=re.compile('Create your piece')).tap();mobile.locator('.type-options label').filter(has_text=re.compile('^T-shirt$')).tap()
 mobile.locator('.create-dialog input[type=file]').set_input_files(str(out/'front.png'));mobile.get_by_alt_text('Your uploaded design').wait_for()
 mobile.get_by_role('button',name='Create T-shirt').tap();mobile.wait_for_selector('.garment-studio',timeout=45000);mobile.wait_for_selector('.create-dialog',state='detached')
 mobile.wait_for_function('()=>JSON.parse(document.querySelector("canvas.rack-canvas").dataset.performance).frontArtwork===true')
 mobile.screenshot(path=str(out/'mobile-touch-upload.png'));result['checks'].append('Native mobile touch creation applies the uploaded design to the specified T-shirt')
 mobile.get_by_role('button',name='CLOSE',exact=True).tap()
 for width,height in [(320,568),(390,400),(844,390),(768,1024)]:
  mobile.set_viewport_size({'width':width,'height':height});mobile.wait_for_timeout(250)
  mobile.get_by_role('button',name=re.compile('Create your piece')).tap()
  dialog=mobile.locator('.create-dialog');dialog.wait_for();bounds=dialog.bounding_box()
  assert bounds['x']>=0 and bounds['y']>=0 and bounds['x']+bounds['width']<=width+1 and bounds['y']+bounds['height']<=height+1
  assert mobile.locator('.create-scroll').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
  submit=mobile.get_by_role('button',name='Create T-shirt');button=submit.bounding_box();assert button['height']>=44 and button['y']>=0 and button['y']+button['height']<=height
  for _ in range(8):
   mobile.keyboard.press('Tab');assert mobile.evaluate('!!document.activeElement.closest(".create-dialog")'),'native dialog must trap focus'
  mobile.screenshot(path=str(out/f'creator-{width}x{height}.png'))
  mobile.keyboard.press('Escape');mobile.wait_for_selector('.create-dialog',state='detached')
 result['checks'].append('Creation dialog fits small and short screens, keeps its action visible, traps focus and supports Escape')
 mobile.evaluate('()=>document.querySelector("canvas.rack-canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()')
 mobile.get_by_role('status').filter(has_text='3D unavailable').wait_for()
 assert mobile.get_by_role('button',name=re.compile('Create your piece')).is_disabled()
 assert mobile.locator('.garment-studio').count()==0
 result['checks'].append('WebGL loss leaves a clear retry preview and disables unavailable customization')
 assert not errors,errors;result['pageErrors']=errors;browser.close()
(out/'results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
