import wave
import sys
import os
import json
from piper import PiperVoice

def synthesize(text, output_path, model_path):
    try:
        # Ensure the output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        
        voice = PiperVoice.load(model_path)
        with wave.open(output_path, "wb") as wav_file:
            voice.synthesize_wav(text, wav_file)
        print(f"Successfully generated: {output_path}")
        return True
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        return False

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python3 tts_service.py <text> <output_path> <model_path>")
        sys.exit(1)
    
    text = sys.argv[1]
    output_path = sys.argv[2]
    model_path = sys.argv[3]
    
    if synthesize(text, output_path, model_path):
        sys.exit(0)
    else:
        sys.exit(1)
