from flask import Flask, jsonify
from flask_cors import CORS
import os

app = Flask(__name__)
CORS(app, origins=['*'])  # Will be restricted later

def handler(request):
    """Health check endpoint for Vercel"""
    return jsonify({
        "status": "healthy",
        "service": "ais360-backend",
        "version": "1.0.0",
        "environment": os.environ.get("VERCEL_ENV", "development")
    })

