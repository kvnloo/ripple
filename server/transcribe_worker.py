"""Local speech-to-text worker for the Ripple review surface.

Reads JSON lines {"id", "path"} on stdin, writes JSON lines
{"id", "text", "words": [{"w", "start", "end"}], "duration", "ms"} on stdout.
faster-whisper (small.en, CPU int8) loaded once. Audio never leaves the host;
the server deletes each file after this worker answers.
"""
import json
import os
import sys
import time

from faster_whisper import WhisperModel

MODEL = os.environ.get('RIPPLE_WHISPER_MODEL', 'small.en')
model = WhisperModel(MODEL, device='cpu', compute_type='int8')
print(json.dumps({'ready': True, 'model': MODEL}), flush=True)

for line in sys.stdin:
    try:
        req = json.loads(line)
    except Exception:
        continue
    t = time.time()
    try:
        # VAD skips silence (a silent hold otherwise loops through temperature
        # fallbacks for 10+ s on a loaded CPU); timestamps stay on the original clock.
        segs, info = model.transcribe(req['path'], word_timestamps=True, vad_filter=True,
                                      vad_parameters={'min_silence_duration_ms': 400},
                                      beam_size=1, temperature=0.0, language='en',
                                      condition_on_previous_text=False)
        words, texts = [], []
        for s in segs:
            texts.append(s.text.strip())
            for w in (s.words or []):
                words.append({'w': w.word.strip(), 'start': round(w.start, 3), 'end': round(w.end, 3)})
        out = {'id': req.get('id'), 'text': ' '.join(texts).strip(), 'words': words,
               'duration': round(getattr(info, 'duration', 0.0), 3), 'ms': int(1000 * (time.time() - t)), 'model': MODEL}
    except Exception as e:  # report, never crash the worker
        out = {'id': req.get('id'), 'error': str(e)[:300]}
    print(json.dumps(out), flush=True)
