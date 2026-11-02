# Audit every source timestamp and decoded JPEG frame.
# Usage: python tools/audit-reference-video.py VIDEO WORK_DIR
# WORK_DIR/reference must contain contiguous frames from ffmpeg, starting at 0000.jpg.
import json,subprocess,hashlib,sys
from pathlib import Path
import cv2,numpy as np
video=Path(sys.argv[1]);root=Path(sys.argv[2]);paths=sorted((root/'reference').glob('*.jpg'))
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',str(video)]))
times=[float(f['best_effort_timestamp_time']) for f in probe['frames']]
assert len(paths)==len(times)==1136
records=[];previous=None
for i,path in enumerate(paths):
 assert int(path.stem)==i
 frame=cv2.imread(str(path));crop=cv2.resize(frame[650:1530,620:2810],(548,220));gray=cv2.cvtColor(crop,cv2.COLOR_BGR2GRAY)
 if previous is None:mean=flow95=0.
 else:
  delta=np.abs(gray.astype(float)-previous.astype(float));mean=float(delta.mean())
  flow=cv2.calcOpticalFlowFarneback(previous,gray,None,.5,3,15,2,5,1.1,0);magnitude=np.linalg.norm(flow,axis=2);edges=cv2.Canny(gray,40,100);mask=cv2.dilate(edges,np.ones((3,3),np.uint8))>0
  flow95=float(np.percentile(magnitude[mask],95)) if mask.any() else 0.
 records.append({'frame':i,'timestamp':times[i],'jpegSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'rackMeanLumaDelta':round(mean,6),'rackEdgeFlowP95':round(flow95,6)})
 previous=gray
 if i%240==0:print('Audited',i,flush=True)
report={'source':'https://x.com/cambreedesigns/status/2104999693113766152','sourceSha256':hashlib.sha256(video.read_bytes()).hexdigest(),'sourceSize':[3448,2160],'fps':60,'frames':len(records),'lastTimestamp':times[-1],'largestTimestampGap':max(b-a for a,b in zip(times,times[1:])),'missingFrameIndices':[],'reviewSheets':32,'scope':'Every original timestamp and consecutive decoded frame. Flow is an image-space diagnostic including occlusion, not a cloth/angle measurement or a similarity score.','frameIndex':records}
(root/'reference-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print('Complete',len(records),flush=True)
