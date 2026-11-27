"""Usage: python -I eval/scripts/wf16.py <in.onnx> <out.onnx>  (needs onnx, numpy; optional self-test needs onnxruntime + pillow)"""
"""Weight-only fp16: large float32 initializers are stored as float16 and cast back to float32 inside the graph."""
import sys, os, onnx, numpy as np
from onnx import helper, numpy_helper, TensorProto
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src); g = m.graph
new_inits, casts, n = [], [], 0
for init in g.initializer:
    if init.data_type == TensorProto.FLOAT and np.prod(init.dims) >= 1024:
        a = numpy_helper.to_array(init).astype(np.float16)
        h = numpy_helper.from_array(a, init.name + "_f16"); new_inits.append(h)
        casts.append(helper.make_node("Cast", [h.name], [init.name], to=TensorProto.FLOAT, name=init.name + "_cast")); n += 1
    else:
        new_inits.append(init)
del g.initializer[:]; g.initializer.extend(new_inits)
nodes = list(g.node); del g.node[:]; g.node.extend(casts + nodes)
onnx.save(m, dst); print(dst, "converted", n, "initializers")
if src.endswith(".fp32.onnx") and os.path.exists(src.replace(".fp32.onnx", ".config.json")):
  pass
else:
  sys.exit(0)
import onnxruntime as ort, json
from PIL import Image
lab = json.load(open(src.replace(".fp32.onnx", ".config.json")))["id2label"]
x = (np.asarray(Image.open("../../fixtures/objects/ctl-knife.jpg").convert("RGB").resize((640, 640), Image.BILINEAR), dtype=np.float32) / 255).transpose(2, 0, 1)[None]
for f in [src, dst]:
    s = ort.InferenceSession(f, providers=["CPUExecutionProvider"]); L = 1 / (1 + np.exp(-s.run(None, {"pixel_values": x})[0][0]))
    i = np.argsort(-L.max(1))[:4]; print(f, [(lab[str(int(L[k].argmax()))], round(float(L[k].max()), 3)) for k in i])
