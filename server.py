# server.py
from flask import Flask, send_from_directory
from pathlib import Path

app = Flask(__name__, static_url_path='', static_folder='.')
DATA_DIR = Path(__file__).parent / 'data'

@app.route('/')
def root():
    return send_from_directory('.', 'index.html')

@app.route('/data/<path:fname>')
def data_file(fname):
    return send_from_directory(DATA_DIR, fname)

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)
