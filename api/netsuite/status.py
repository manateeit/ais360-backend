from flask import Flask, jsonify, request
from flask_cors import CORS
import os
import json

app = Flask(__name__)

def validate_api_key(request):
    """Validate API key from request headers"""
    api_key = request.headers.get('X-API-Key')
    expected_key = os.environ.get('API_SECRET_KEY')
    return api_key and api_key == expected_key

def handler(request):
    """NetSuite status endpoint for Vercel"""
    
    # Validate API key
    if not validate_api_key(request):
        return jsonify({"error": "Unauthorized"}), 401
    
    # Set CORS headers
    if request.method == 'OPTIONS':
        return '', 200
    
    try:
        # Check NetSuite configuration
        required_vars = [
            'NETSUITE_ACCOUNT_ID',
            'NETSUITE_CONSUMER_KEY', 
            'NETSUITE_CONSUMER_SECRET',
            'NETSUITE_TOKEN_ID',
            'NETSUITE_TOKEN_SECRET'
        ]
        
        missing_vars = [var for var in required_vars if not os.environ.get(var)]
        
        if missing_vars:
            return jsonify({
                "status": "error",
                "message": f"Missing environment variables: {', '.join(missing_vars)}"
            }), 500
        
        return jsonify({
            "status": "ok",
            "service": "netsuite-api",
            "account_id": os.environ.get('NETSUITE_ACCOUNT_ID'),
            "configured": True
        })
        
    except Exception as e:
        return jsonify({
            "status": "error", 
            "message": str(e)
        }), 500

# Configure CORS
@app.after_request
def after_request(response):
    frontend_url = os.environ.get('FRONTEND_URL', 'http://localhost:5173')
    response.headers.add('Access-Control-Allow-Origin', frontend_url)
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

