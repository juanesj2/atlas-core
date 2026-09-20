import uvicorn
import os
import sys

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from src.biometrics.server import app

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
