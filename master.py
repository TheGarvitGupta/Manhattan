from flask import Flask
from flask import send_from_directory
app = Flask(__name__)

kAuthorizationClientStaticFile = "AuthorizationClient.html"

@app.route('/')
def home():
    return send_from_directory('html', kAuthorizationClientStaticFile)

@app.route('/javascript/<path:path>')
def javascript(path):
    return send_from_directory('javascript', path)

@app.route('/css/<path:path>')
def css(path):
    return send_from_directory('css', path)