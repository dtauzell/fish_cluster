fish.mov, default crop x=50 y=240 width=420 height=290; FFmpeg RGBA decoded
and converted with the production grayscale function. previous=1.4s, current=1.6s.
Background is the production median of 25 evenly spaced samples across 120.316667s.
At 1.6s the old previous-frame merge heuristic associated two preceding centers
with a single ordinary-sized fish; center preference then produced an incorrect
split. Five fish remain distinct in this frame. Inputs are gzip-compressed PGM.
